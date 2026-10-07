// Adapter duy nhất gọi OpenAI để phân loại; response format buộc JSON schema và không cung cấp tool hay quyền truy cập.
import type { SellerQuestionCapabilityRegistry } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.types';
import { buildSellerQuestionRegistryCatalog } from '@/modules/seller-copilot/application/question-understanding/shared/registry/seller-question-capability-registry.util';
import type {
    SellerQuestionPlannerPort,
    SellerQuestionPlannerResult,
} from '@/modules/seller-copilot/application/question-understanding/shared/planner/contracts/seller-question-planner.port';
import { AGENT_PLANNER_RULE } from '@/modules/seller-copilot/application/question-understanding/modes/agent/planner-rule';
import { CHAT_PLANNER_RULE } from '@/modules/seller-copilot/application/question-understanding/modes/chat/planner-rule';
import { KNOWLEDGE_PLANNER_RULE } from '@/modules/seller-copilot/application/question-understanding/modes/knowledge/planner-rule';
import { SHOP_DATA_PLANNER_RULE } from '@/modules/seller-copilot/application/question-understanding/modes/shop-data/planner-rule';
import { SELLER_QUESTION_SHOP_DATA_INTENTS } from '@/modules/seller-copilot/application/question-understanding/shared/types/seller-question-plan.types';
import { Injectable } from '@nestjs/common';

export interface OpenAiSellerQuestionPlannerOptions {
    apiKey: string;
    model: string;
    timeoutMs: number;
}

type FetchLike = (
    input: string | URL | Request,
    init?: RequestInit,
) => Promise<Response>;

const PLANNER_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MAX_COMPLETION_TOKENS = 1600;

@Injectable()
export class OpenAiSellerQuestionPlannerClient implements SellerQuestionPlannerPort {
    // Cho phép inject fetcher để test lỗi/response mà không gọi mạng; production mặc định dùng fetch chuẩn.
    constructor(
        private readonly options: OpenAiSellerQuestionPlannerOptions,
        private readonly fetcher: FetchLike = fetch,
    ) {}

    // Gửi câu hiện tại, context đã giới hạn và registry; không gửi shopId, dữ liệu live hay nội dung tài liệu.
    async classify(input: {
        question: string;
        history: Array<{ role: 'user' | 'assistant'; content: string }>;
        interactionMode?: 'chat' | 'shop_data' | 'knowledge' | 'agent';
        registry: SellerQuestionCapabilityRegistry; // Registry cung cấp request type, domain và ví dụ ngữ nghĩa được phép.
        signal?: AbortSignal;
    }): Promise<SellerQuestionPlannerResult> {
        // Nếu chưa cấu hình API key thì không gọi OpenAI; trả về lỗi AI_NOT_CONFIGURED để lớp application xử lý.
        if (!this.options.apiKey.trim()) {
            return { kind: 'failure', reason: 'AI_NOT_CONFIGURED' };
        }

        let response: Response;
        const timeoutSignal = AbortSignal.timeout(this.options.timeoutMs);
        const requestSignal = input.signal
            ? AbortSignal.any([input.signal, timeoutSignal])
            : timeoutSignal;

        // Gọi OpenAI Chat Completions với model, temperature, max tokens và response format JSON schema; truyền câu hỏi hiện tại, lịch sử hội thoại đã chuẩn hóa và catalog registry.
        try {
            response = await this.fetcher(PLANNER_ENDPOINT, {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${this.options.apiKey}`,
                    'content-type': 'application/json',
                },
                signal: requestSignal,
                body: JSON.stringify({
                    model: this.options.model,
                    temperature: 0,
                    max_completion_tokens: MAX_COMPLETION_TOKENS,
                    response_format: {
                        type: 'json_schema',
                        json_schema: {
                            name: 'seller_question_plan',
                            strict: true,
                            schema: buildPlannerResponseSchema(input.registry),
                        },
                    },
                    messages: [
                        {
                            role: 'system',
                            content: buildSellerQuestionPlannerInstructions(
                                input.registry,
                            ),
                        },
                        {
                            role: 'user',
                            content: JSON.stringify({
                                recentConversation: input.history,
                                currentQuestion: input.question,
                                interactionMode:
                                    input.interactionMode ?? 'chat',
                            }),
                        },
                    ],
                }),
            });
        } catch (error) {
            // Chỉ chuyển timeout/provider lỗi thành kết quả lỗi; tín hiệu hủy từ browser phải thoát ra để dừng use case.
            if (input.signal?.aborted) throw error;
            return { kind: 'failure', reason: 'AI_PROVIDER_ERROR' };
        }

        // HTTP lỗi là sự cố provider; body lỗi không được lưu để tránh rò rỉ thông tin xác thực hoặc dữ liệu gửi kèm.
        if (!response.ok) {
            return { kind: 'failure', reason: 'AI_PROVIDER_ERROR' };
        }

        let payload: unknown;

        // Nếu response không parse được JSON hoặc không có content thì trả về lỗi AI_INVALID_RESPONSE.
        try {
            payload = await response.json();
        } catch {
            return { kind: 'failure', reason: 'AI_INVALID_RESPONSE' };
        }

        // Nhận diện từ chối và output bị cắt riêng; cả hai đều là lỗi kỹ thuật, không phải phân loại UNCLEAR.
        const completion = readCompletion(payload);
        if (completion?.kind === 'refusal') {
            return {
                kind: 'failure',
                reason: 'AI_REFUSAL',
                ...(completion.tokenUsage
                    ? { usage: completion.tokenUsage }
                    : {}),
            };
        }
        if (completion?.kind === 'incomplete') {
            return {
                kind: 'failure',
                reason: 'AI_INCOMPLETE_RESPONSE',
                ...(completion.tokenUsage
                    ? { usage: completion.tokenUsage }
                    : {}),
            };
        }
        if (!completion || completion.kind !== 'content') {
            return {
                kind: 'failure',
                reason: 'AI_INVALID_RESPONSE',
                ...(completion?.tokenUsage
                    ? { usage: completion.tokenUsage }
                    : {}),
            };
        }

        // Nếu content parse được JSON thì trả về success; nếu không parse được thì trả về lỗi AI_INVALID_RESPONSE.
        try {
            return {
                kind: 'success',
                response: JSON.parse(completion.content) as unknown,
                ...(completion.tokenUsage
                    ? { usage: completion.tokenUsage }
                    : {}),
            };
        } catch {
            return {
                kind: 'failure',
                reason: 'AI_INVALID_RESPONSE',
                ...(completion.tokenUsage
                    ? { usage: completion.tokenUsage }
                    : {}),
            };
        }
    }
}

// Chỉ cho model chọn request type/domain đã khai báo; backend validator kiểm tra lại cặp này.
function buildPlannerResponseSchema(
    registry: SellerQuestionCapabilityRegistry,
): Record<string, unknown> {
    // Registry là danh sách cho phép duy nhất; không cho model tự phát minh request type hoặc domain.
    const requestTypes = registry.requestTypes.map((item) => item.code);

    // Lấy danh sách domain từ registry; domain có thể là null nếu task không cần domain.
    const domains = registry.domains.map((domain) => domain.code);

    return {
        type: 'object',
        additionalProperties: false,
        required: [
            'status',
            'contextRelation',
            'tasks',
            'clarificationQuestion',
        ],
        properties: {
            status: {
                type: 'string',
                enum: ['READY', 'NEEDS_CLARIFICATION', 'OUT_OF_SCOPE'],
            },
            contextRelation: {
                type: 'string',
                enum: ['NEW_TOPIC', 'FOLLOW_UP', 'CLARIFICATION_REPLY'],
            },
            tasks: {
                type: 'array',
                maxItems: 8,
                items: {
                    type: 'object',
                    additionalProperties: false,
                    required: [
                        'requestType',
                        'domain',
                        'resolvedQuestion',
                        'shopDataIntent',
                    ],
                    properties: {
                        requestType: { type: 'string', enum: requestTypes },
                        domain: {
                            type: ['string', 'null'],
                            enum: [...domains, null],
                        },
                        resolvedQuestion: { type: 'string' },
                        shopDataIntent: {
                            type: ['string', 'null'],
                            enum: [...SELLER_QUESTION_SHOP_DATA_INTENTS, null],
                        },
                    },
                },
            },
            clarificationQuestion: { type: ['string', 'null'] },
        },
    };
}

// Giải thích rõ ý nghĩa contract và thứ tự ra quyết định để model phân loại theo ngữ cảnh, không đoán từ tên field.
// Ví dụ chỉ minh họa cách tạo plan; registry mới là allowlist requestType/domain và validator backend vẫn là chốt cuối.
export function buildSellerQuestionPlannerInstructions(
    registry: SellerQuestionCapabilityRegistry,
): string {
    const catalog = buildSellerQuestionRegistryCatalog(registry);
    return [
        'VAI TRÒ',
        'Bạn là bộ hiểu ý định và phân loại câu hỏi tiếng Việt cho trợ lý vận hành seller. Nhiệm vụ duy nhất là biến tin nhắn thành plan có cấu trúc để backend chọn bước xử lý tiếp theo; bạn không trả lời câu hỏi nghiệp vụ.',
        '',
        'Ý NGHĨA CÁC KHÁI NIỆM',
        '- requestType mô tả người dùng muốn làm gì: trò chuyện, hỏi khả năng trợ lý, đọc/tra cứu thông tin, yêu cầu thay đổi dữ liệu, hoặc việc ngoài phạm vi.',
        '- domain mô tả người dùng đang hỏi về chủ đề nào; nó độc lập với requestType. Ví dụ cùng domain tồn kho có thể xuất hiện trong câu hỏi “còn bao nhiêu?”, câu “bạn có sửa được không?” hoặc yêu cầu “cập nhật lên 20”.',
        '- Chọn domain chỉ trong registry và chỉ khi domain được phép cho requestType đó; dùng null khi loại yêu cầu không gắn domain.',
        '- resolvedQuestion là cách diễn đạt lại yêu cầu hiện tại thành một câu tự đủ nghĩa để bước sau xử lý độc lập. Giữ nguyên ý người dùng, không tự thêm dữ kiện, điều kiện, con số hoặc câu trả lời.',
        '- shopDataIntent là intent nghiệp vụ có cấu trúc, chỉ chọn enum khi interactionMode=shop_data và task là READ_QUERY thuộc domain live tương ứng; mode/domain khác phải để null. Chọn theo nghĩa toàn câu và ngữ cảnh, không theo một từ khóa riêng lẻ.',
        '- tasks là các yêu cầu độc lập trong tin nhắn hiện tại. Chỉ tách khi người dùng thực sự hỏi nhiều việc; giữ nguyên thứ tự họ nêu và không tạo task trùng lặp.',
        '- status mô tả kết quả phân loại, không phải kết quả trả lời: READY nghĩa là đã đủ thông tin để định tuyến; NEEDS_CLARIFICATION nghĩa là phải hỏi thêm; OUT_OF_SCOPE nghĩa là yêu cầu nằm ngoài hỗ trợ seller.',
        '- contextRelation mô tả quan hệ của tin nhắn hiện tại với hội thoại: NEW_TOPIC là chủ đề mới; FOLLOW_UP là câu nối tiếp; CLARIFICATION_REPLY là câu trả lời cho câu hỏi làm rõ gần nhất.',
        '- clarificationQuestion là câu hỏi ngắn cần gửi lại người dùng khi chưa thể phân loại an toàn; để null ở các status còn lại.',
        '',
        'CÁCH PHÂN LOẠI REQUEST TYPE VÀ DOMAIN',
        '- Trước hết xác định người dùng đang xã giao, hỏi BinGPT có hỗ trợ việc gì, muốn tra cứu/giải thích thông tin, hay đang yêu cầu thực hiện một thay đổi. Cách nói lịch sự như “giúp tôi” không tự biến yêu cầu thay đổi thành câu hỏi về khả năng.',
        '- SMALL_TALK: lời chào, gọi trợ lý, cảm ơn, tạm biệt hoặc xã giao ngắn. Trả plan READY với một task SMALL_TALK và domain null; không hỏi làm rõ chỉ vì câu ngắn hoặc chưa nêu nghiệp vụ.',
        '- CAPABILITY_QUERY: hỏi về chức năng/phạm vi BinGPT, không yêu cầu thực hiện ngay; domain luôn là seller-copilot-capabilities. Ví dụ “BinGPT có hỗ trợ cập nhật tồn kho không?” là hỏi khả năng; “Cập nhật tồn kho lên 20 giúp tôi” là yêu cầu thay đổi.',
        '- Trong hội thoại trực tiếp với trợ lý, “bạn/mày làm được gì?”, “bạn hỗ trợ gì?” là cách gọi trợ lý và phải được hiểu là CAPABILITY_QUERY/seller-copilot-capabilities; resolvedQuestion cần nêu rõ “BinGPT” để truy xuất không phụ thuộc đại từ. “Bạn ơi” không kèm yêu cầu vẫn là SMALL_TALK. Không thay “tao/tôi/mình” bằng BinGPT: đó thường là người bán đang nói về chính họ; xét cả động từ, đối tượng và lịch sử trước khi chọn ý định.',
        '- READ_QUERY: muốn xem, biết, giải thích hoặc được hướng dẫn. Chọn domain theo điều người dùng muốn biết và loại nguồn cần dùng; các domain gần nghĩa phải phân biệt theo quy tắc và ví dụ bên dưới.',
        '- CHANGE_REQUEST: muốn tạo/cập nhật/xóa/thay đổi dữ liệu. Chọn domain của đối tượng cần thay đổi; đây chỉ là phân loại ý định, không phải quyền thực thi hay xác nhận thao tác thành công.',
        // Ghép lại thành đúng một rule liền mạch như trước để việc tách ownership không đổi prompt gửi tới model.
        `${AGENT_PLANNER_RULE} ${CHAT_PLANNER_RULE.slice(2)}`,
        KNOWLEDGE_PLANNER_RULE,
        SHOP_DATA_PLANNER_RULE,
        '- Với CHANGE_REQUEST, nếu động từ thao tác và đối tượng đã rõ thì tạo task READY dù còn thiếu giá trị mới, nội dung cần sửa hoặc lựa chọn chi tiết. Việc thiếu tham số chỉ ảnh hưởng bước thực hiện sau, không làm mơ hồ ý định phân loại; ví dụ “Sửa mô tả shop thành nội dung sau đây” vẫn là CHANGE_REQUEST/seller-profile và “Tạo bản nháp sản phẩm mới từ thông tin tôi gửi sau đây” là CHANGE_REQUEST/seller-products-inventory.',
        '- “Xác nhận tất cả đơn đang chờ giúp tôi” là CHANGE_REQUEST/seller-orders vì user yêu cầu đổi trạng thái; “Đơn nào đang chờ xác nhận?” là READ_QUERY/seller-orders. Câu như “Tôi muốn tìm phần cấu hình shop” đã đủ để route tới seller-center-troubleshooting dù chưa nêu tên nút con; không hỏi lại nếu nhóm màn hình/chức năng đã rõ.',
        '- OUT_OF_SCOPE: ý định rõ ràng nằm ngoài hỗ trợ seller. Câu mơ hồ phải hỏi lại, không được gán ngoài phạm vi theo phỏng đoán.',
        '',
        'RANH GIỚI GIỮA CÁC DOMAIN GẦN NGHĨA',
        '- seller-revenue dùng khi người bán cần con số tổng hợp live trên dashboard hoặc xu hướng doanh thu theo kỳ. Nếu hỏi quy tắc xác định khoản nào được tính, cách ghi nhận, COD hay tiền đã chuyển về shop thì dùng fees-settlement.',
        '- seller-orders: số lượng đơn hoặc dữ liệu/trạng thái của một đơn cụ thể trong shop. order-status chỉ dùng để giải thích ý nghĩa hay quan hệ giữa các trạng thái nói chung; order-processing dùng cho quy trình seller tiếp nhận, chuẩn bị, bàn giao và xử lý đơn.',
        '- seller-products-inventory: danh sách/thông tin sản phẩm, tồn kho và sản phẩm bán chạy/top sản phẩm. Không dùng seller-revenue chỉ vì câu hỏi về sản phẩm có nhắc doanh số hoặc doanh thu của từng sản phẩm.',
        '- fees-settlement: quy tắc tính phí giao hàng/COD, ghi nhận khoản thu, phân biệt đã thu tiền với tiền đã chuyển cho shop, cùng chính sách và giới hạn đối soát. Nếu hỏi “đơn báo đã thu tiền, vậy tiền đã chuyển về shop chưa?” thì chọn fees-settlement; nếu hỏi “doanh thu shop 30 ngày này bao nhiêu?” thì chọn seller-revenue. Không dùng fees-settlement cho con số doanh thu dashboard live của một kỳ.',
        '- shipping: cấu hình giao nhận, địa chỉ lấy hàng, điều kiện shop sẵn sàng giao, báo giá và vận đơn. order-processing là các bước shop xử lý đơn; seller-center-troubleshooting là hỏi vị trí màn hình hoặc cách tìm chức năng trong giao diện.',
        'Ví dụ đối chiếu: “Đơn gần nhất đang ở trạng thái nào?” → seller-orders; “DELIVERED khác COMPLETED thế nào?” → order-status. “Sản phẩm nào bán chạy nhất?” → seller-products-inventory; “Doanh thu shop tháng này bao nhiêu?” → seller-revenue. “Doanh thu được ghi nhận thế nào?” hoặc “Hệ thống hiện lưu những thông tin nào về đối soát?” → fees-settlement; “Mục đối soát nằm ở menu nào trong Seller Center?” → seller-center-troubleshooting. “Shop cần gì để sẵn sàng giao hàng?” → shipping; “Shop chuẩn bị và bàn giao đơn theo bước nào?” → order-processing.',
        'Mô tả và ví dụ trong registry giúp hiểu nghĩa, không phải bộ từ khóa cứng. Xét ý định cả câu và lịch sử phù hợp.',
        '',
        'CÁCH XÁC ĐỊNH NGỮ CẢNH',
        '- NEW_TOPIC: câu hiện tại nêu một yêu cầu/chủ đề mới hoặc không có lịch sử liên quan; không tự suy ra follow-up chỉ từ câu ngắn hay đại từ nếu history không xác định được chủ đề.',
        '- FOLLOW_UP: câu hiện tại tiếp tục chủ đề đã được trả lời/trao đổi, như “còn số đơn thì sao?”. Lấy yêu cầu gần nhất của user làm gốc; giữ mọi điều kiện chưa bị user thay đổi, đặc biệt đối tượng, sản phẩm/biến thể, khoảng thời gian, trạng thái và đơn vị đo. Nếu user đổi một thuộc tính thì chỉ thay thuộc tính đó. Câu resolvedQuestion phải viết lại đủ các điều kiện được kế thừa thay vì chỉ nói “cùng kỳ”, “sản phẩm đó” hoặc giữ đại từ. Câu trả lời assistant chỉ giúp hiểu chủ đề, không phải bằng chứng để lặp lại số liệu cũ.',
        '- CLARIFICATION_REPLY: lượt assistant gần nhất đang yêu cầu người dùng chọn hoặc bổ sung thông tin, và câu hiện tại trả lời đúng yêu cầu đó, như assistant hỏi “7, 30 hay 90 ngày?” rồi user đáp “7 ngày”. Nếu chỉ nhắc tiếp chủ đề sau một câu trả lời thông thường thì đó là FOLLOW_UP.',
        'Lịch sử chỉ giúp hiểu đại từ, lựa chọn và chủ đề đang nối tiếp; không xem câu trả lời cũ là bằng chứng cho số liệu hoặc chính sách hiện tại.',
        '',
        'QUY TẮC CHỌN STATUS VÀ DOMAIN',
        '- READY: có ít nhất một task trong phạm vi đủ rõ để định tuyến. Nếu tin nhắn có cả ý trong và ngoài phạm vi, giữ các task theo thứ tự; không bỏ mất phần trong phạm vi.',
        '- NEEDS_CLARIFICATION: chỉ dùng khi cả câu hiện tại lẫn lịch sử không cho biết người dùng muốn hỏi/làm gì hoặc không thể chọn domain an toàn. Không hỏi thêm thông tin chỉ phục vụ bước trả lời sau nếu domain đã rõ; khi cần làm rõ, tasks phải rỗng và clarificationQuestion chỉ hỏi đúng phần còn thiếu.',
        '- OUT_OF_SCOPE: chỉ dùng khi mọi yêu cầu trong tin nhắn đều rõ ràng ngoài phạm vi; tasks phải chứa các ý ngoài phạm vi với requestType OUT_OF_SCOPE.',
        '- Không dùng status để báo thiếu API key, lỗi mạng hoặc lỗi model; các lỗi kỹ thuật do backend xử lý riêng.',
        '- Domain phải khớp chính xác mã trong registry và nằm trong danh sách domains của requestType đó. Ưu tiên domain sát nội dung nhất; không tự đặt domain mới.',
        '- Với câu hỏi chính sách, chỉ chọn domain và viết resolvedQuestion đủ rõ để bước retrieval tìm tài liệu; không chọn documentId, không trích nội dung tài liệu và không tự trả lời.',
        '- Với dữ liệu live/hồ sơ/thao tác, chỉ phân loại và chuẩn hóa yêu cầu; không tuyên bố đã truy vấn dữ liệu hoặc thay đổi dữ liệu.',
        '',
        'VÍ DỤ CÁCH TRẢ PLAN',
        'Ví dụ 1 — hỏi chính sách: “Phí giao hàng được tính thế nào?” → READY, READ_QUERY, domain fees-settlement.',
        'Ví dụ 2 — cùng đối tượng, khác mục đích: “BinGPT có chức năng cập nhật tồn kho không?” → CAPABILITY_QUERY/seller-copilot-capabilities; “Cập nhật tồn kho sản phẩm A lên 20 giúp tôi” → CHANGE_REQUEST/seller-products-inventory; “Tồn kho sản phẩm A hiện còn bao nhiêu?” → READ_QUERY/seller-products-inventory.',
        'Ví dụ 3 — lời gọi ngắn vẫn là xã giao: “Bạn ơi” → READY, một task SMALL_TALK domain null; không hỏi người dùng đang muốn hỏi nghiệp vụ gì.',
        'Ví dụ 4 — follow-up: history đang nói về trạng thái đơn hàng, câu hiện tại là “Nếu nó vẫn đứng ở đó thì sao?” → FOLLOW_UP; resolvedQuestion phải nêu rõ đối tượng từ history, không giữ đại từ “nó”.',
        '{"status":"READY","contextRelation":"FOLLOW_UP","tasks":[{"requestType":"READ_QUERY","domain":"order-status","resolvedQuestion":"Nếu đơn hàng vẫn ở trạng thái đang giao quá lâu thì shop nên kiểm tra và xử lý thế nào?"}],"clarificationQuestion":null}',
        'Ví dụ 4a — follow-up đổi domain nhưng giữ thời gian: history hỏi doanh thu shop trong 30 ngày gần nhất, user tiếp “Còn số đơn thì sao?” → FOLLOW_UP/seller-orders; resolvedQuestion phải hỏi số đơn trong cùng khoảng 30 ngày, không chỉ viết “Số đơn là bao nhiêu?”.',
        'Input: {"recentConversation":[{"role":"user","content":"Doanh thu shop trong 30 ngày gần nhất là bao nhiêu?"},{"role":"assistant","content":"Mình đã trả lời doanh thu trong khoảng thời gian đó."}],"currentQuestion":"Còn số đơn thì sao?"}',
        '{"status":"READY","contextRelation":"FOLLOW_UP","tasks":[{"requestType":"READ_QUERY","domain":"seller-orders","resolvedQuestion":"Trong 30 ngày gần nhất shop có bao nhiêu đơn hàng?"}],"clarificationQuestion":null}',
        'Ví dụ 4b — follow-up đổi thuộc tính nhưng giữ đối tượng và thuộc tính khác: history hỏi tồn áo thun màu trắng size M, user tiếp “Còn màu đen thì sao?” → FOLLOW_UP/seller-products-inventory; đổi màu sang đen nhưng giữ áo thun, size M và ý hỏi số lượng tồn.',
        'Input: {"recentConversation":[{"role":"user","content":"Áo thun màu trắng size M còn bao nhiêu?"},{"role":"assistant","content":"Biến thể trắng size M hiện còn 6 cái."}],"currentQuestion":"Còn màu đen thì sao?"}',
        '{"status":"READY","contextRelation":"FOLLOW_UP","tasks":[{"requestType":"READ_QUERY","domain":"seller-products-inventory","resolvedQuestion":"Áo thun màu đen size M hiện còn bao nhiêu sản phẩm?"}],"clarificationQuestion":null}',
        'Ví dụ 5 — trả lời làm rõ: assistant hỏi “Bạn muốn xem thông tin tài khoản hay shop?”, user đáp “Cả hai” → CLARIFICATION_REPLY và tạo hai task READ_QUERY trên domain seller-profile, lần lượt tài khoản rồi shop.',
        '{"status":"READY","contextRelation":"CLARIFICATION_REPLY","tasks":[{"requestType":"READ_QUERY","domain":"seller-profile","resolvedQuestion":"Thông tin hồ sơ tài khoản hiện tại của người dùng gồm những gì?"},{"requestType":"READ_QUERY","domain":"seller-profile","resolvedQuestion":"Thông tin hồ sơ shop hiện tại của người dùng gồm những gì?"}],"clarificationQuestion":null}',
        'Ví dụ 6 — chưa đủ ngữ cảnh: “Cái đó thì sao?” nhưng history không cho biết “cái đó” là gì → NEEDS_CLARIFICATION, tasks là [], clarificationQuestion hỏi người dùng đang muốn nói tới nội dung nào.',
        '{"status":"NEEDS_CLARIFICATION","contextRelation":"NEW_TOPIC","tasks":[],"clarificationQuestion":"Bạn đang muốn hỏi về nội dung hoặc thao tác nào vậy?"}',
        'Ví dụ 7 — nhiều ý: “Đơn nào đang chờ xử lý và sản phẩm nào sắp hết hàng?” → hai task READ_QUERY theo thứ tự; domain lần lượt seller-orders và seller-products-inventory.',
        '{"status":"READY","contextRelation":"NEW_TOPIC","tasks":[{"requestType":"READ_QUERY","domain":"seller-orders","resolvedQuestion":"Đơn hàng nào của shop hiện đang chờ xử lý?"},{"requestType":"READ_QUERY","domain":"seller-products-inventory","resolvedQuestion":"Sản phẩm nào của shop hiện sắp hết hàng?"}],"clarificationQuestion":null}',
        '',
        'QUY TẮC ĐẦU RA',
        '- Tuân thủ JSON Schema được cung cấp: chỉ trả đúng các trường đã khai báo, không thêm Markdown, lời dẫn, nhận xét hoặc chain-of-thought.',
        '- Mọi task phải có requestType, domain và resolvedQuestion. resolvedQuestion phải ngắn gọn, tự đủ nghĩa và không phải câu trả lời.',
        '- Chỉ dùng clarificationQuestion khi status là NEEDS_CLARIFICATION; status khác phải để null.',
        '- Không dùng NEEDS_CLARIFICATION như lựa chọn mặc định khi còn chút không chắc chắn. Nếu ý định và domain đã đủ rõ để chuyển đúng luồng, hãy tạo task; chỉ hỏi lại khi thiếu thông tin cốt yếu khiến có nhiều cách định tuyến khác nhau.',
        `Registry: ${JSON.stringify(catalog)}`,
    ].join('\n');
}

// Tách completion thành kết quả có nghĩa kỹ thuật để evaluator không gộp từ chối/cắt cụt vào lỗi JSON.
function readCompletion(value: unknown):
    | {
          kind: 'content';
          content: string;
          tokenUsage: {
              promptTokens: number;
              completionTokens: number;
              totalTokens: number;
          } | null;
      }
    | {
          kind: 'refusal' | 'incomplete' | 'invalid';
          tokenUsage: {
              promptTokens: number;
              completionTokens: number;
              totalTokens: number;
          } | null;
      }
    | null {
    // Giữ usage trước khi kiểm tra phần nội dung; response sai schema vẫn có thể đã tiêu thụ token.
    if (!isRecord(value)) return null;
    const usage = isRecord(value.usage) ? value.usage : null;
    const promptTokens = usage?.prompt_tokens;
    const completionTokens = usage?.completion_tokens;
    const totalTokens = usage?.total_tokens;
    const tokenUsage =
        Number.isInteger(promptTokens) &&
        Number.isInteger(completionTokens) &&
        Number.isInteger(totalTokens) &&
        Number(promptTokens) >= 0 &&
        Number(completionTokens) >= 0 &&
        Number(totalTokens) >= 0
            ? {
                  promptTokens: Number(promptTokens),
                  completionTokens: Number(completionTokens),
                  totalTokens: Number(totalTokens),
              }
            : null;

    // Envelope thiếu lựa chọn hoặc message vẫn là lỗi định dạng, nhưng không vứt bỏ usage vừa đọc.
    if (!Array.isArray(value.choices)) return { kind: 'invalid', tokenUsage };
    const firstChoice = value.choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
        return { kind: 'invalid', tokenUsage };
    }

    // finish_reason=length nghĩa là model bị dừng giữa output; không đưa JSON có thể cụt vào validator.
    if (firstChoice.finish_reason === 'length') {
        return { kind: 'incomplete', tokenUsage };
    }

    // Từ chối có marker riêng trong Chat Completions; không diễn giải nội dung từ chối thành plan.
    if (
        typeof firstChoice.message.refusal === 'string' &&
        firstChoice.message.refusal.trim()
    ) {
        return { kind: 'refusal', tokenUsage };
    }

    // Chỉ nhận content dạng chuỗi; object hoặc null đều là envelope không đúng contract dự kiến.
    if (typeof firstChoice.message.content !== 'string') {
        return { kind: 'invalid', tokenUsage };
    }

    return {
        kind: 'content',
        content: firstChoice.message.content,
        tokenUsage,
    };
}

// Tránh ép kiểu envelope bên ngoài trước khi kiểm tra các trường cần thiết.
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
