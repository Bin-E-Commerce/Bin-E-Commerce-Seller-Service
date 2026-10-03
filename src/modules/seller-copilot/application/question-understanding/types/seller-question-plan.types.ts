// Khai báo contract nội bộ để planner mô tả ý người bán và các bước xử lý tiếp theo.
// Các kiểu này không phải DTO/SSE công khai; chúng không cấp quyền truy cập hay tự gọi nguồn dữ liệu.

// Trục này mô tả người dùng muốn trợ lý làm gì; domain là trục riêng mô tả nội dung cần tra.
export const SELLER_QUESTION_REQUEST_TYPES = [
    'SMALL_TALK',
    'CAPABILITY_QUERY',
    'READ_QUERY',
    'CHANGE_REQUEST',
    'OUT_OF_SCOPE',
] as const;

// Union literal giúp contract, registry, prompt và validator dùng cùng một bộ request type.
export type SellerQuestionRequestType =
    (typeof SELLER_QUESTION_REQUEST_TYPES)[number];

// Quan hệ của câu hiện tại với hội thoại trước, độc lập với loại yêu cầu và domain.
export const SELLER_CONTEXT_RELATIONS = [
    // Câu hỏi có chủ đề riêng; không cần diễn giải dựa vào nội dung trước đó.
    'NEW_TOPIC',
    // Câu hỏi tiếp nối cùng chủ đề; cần dùng lượt trước để hiểu đại từ hoặc phần bị lược.
    'FOLLOW_UP',
    // Câu hiện tại trả lời yêu cầu làm rõ gần nhất, chẳng hạn chọn một trong các phương án.
    'CLARIFICATION_REPLY',
] as const;

// Kiểu đóng của quan hệ ngữ cảnh mà planner được phép trả về.
export type SellerContextRelation = (typeof SELLER_CONTEXT_RELATIONS)[number];

// Trạng thái cho biết kết quả phân loại có thể chuyển tiếp hay cần xử lý đặc biệt.
export const SELLER_QUESTION_PLAN_STATUSES = [
    // Plan hợp lệ và có task để phase sau định tuyến tới capability tương ứng; chưa đồng nghĩa đã có câu trả lời.
    'READY',
    // Thiếu thông tin quan trọng; cần hỏi người dùng thêm và chưa gửi task nghiệp vụ đi xử lý.
    'NEEDS_CLARIFICATION',
    // Planner xác định yêu cầu nằm ngoài phạm vi hỗ trợ seller.
    'OUT_OF_SCOPE',
    // Planner không thể chạy do thiếu cấu hình hoặc lỗi nhà cung cấp; đây không phải lỗi do câu hỏi mơ hồ.
    'PLANNER_UNAVAILABLE',
    // Có phản hồi planner nhưng dữ liệu không hợp schema/contract nên không được dùng để định tuyến.
    'PLANNER_INVALID_RESPONSE',
] as const;

// Union literal của các trạng thái plan; caller dựa vào đây để phân biệt kết quả nghiệp vụ và lỗi kỹ thuật.
export type SellerQuestionPlanStatus =
    (typeof SELLER_QUESTION_PLAN_STATUSES)[number];

// Nguyên nhân kỹ thuật cụ thể khi planner không thể tạo một kết quả phân loại hợp lệ.
export const SELLER_QUESTION_PLANNER_FAILURES = [
    // Chưa cấu hình API key hoặc cấu hình cần thiết để gọi AI.
    'AI_NOT_CONFIGURED',
    // Lỗi mạng, timeout hoặc HTTP từ nhà cung cấp AI.
    'AI_PROVIDER_ERROR',
    // Nhà cung cấp trả JSON rỗng, sai định dạng hoặc không đáp ứng schema nội bộ.
    'AI_INVALID_RESPONSE',
    // Nhà cung cấp chủ động từ chối yêu cầu; tách riêng để không nhầm với lỗi hiểu câu hỏi.
    'AI_REFUSAL',
    // Nhà cung cấp dừng khi chưa hoàn tất câu trả lời, thường do giới hạn token.
    'AI_INCOMPLETE_RESPONSE',
] as const;

// Kiểu lỗi đóng để code xử lý lỗi không phụ thuộc các chuỗi tùy ý dễ gõ sai.
export type SellerQuestionPlannerFailure =
    (typeof SELLER_QUESTION_PLANNER_FAILURES)[number];

// Một ý định độc lập được tách ra từ tin nhắn; thứ tự tasks giữ đúng thứ tự người dùng nêu.
export interface SellerQuestionTask {
    // Mục đích thao tác: trò chuyện, hỏi khả năng, đọc thông tin, yêu cầu thay đổi hoặc ngoài phạm vi.
    requestType: SellerQuestionRequestType;
    // Nội dung cần xử lý độc lập với requestType; null chỉ khi request type không cần domain.
    domain: string | null;
    // Câu hỏi đã diễn giải đủ nghĩa để phase sau dùng mà không phải tự nối đại từ với lịch sử lần nữa.
    resolvedQuestion: string;
}

// Toàn bộ quyết định phân loại của một tin nhắn, trước khi retrieval/live-data/answer pipeline xử lý các task.
export interface SellerQuestionPlan {
    // Trạng thái tổng thể; quy tắc nhất quán giữa status, tasks và failureReason được validator bảo đảm.
    status: SellerQuestionPlanStatus;
    // Cho biết model xem câu hiện tại là chủ đề mới, câu tiếp nối hay câu trả lời làm rõ.
    contextRelation: SellerContextRelation;
    // Các ý cần xử lý theo thứ tự xuất hiện; mảng rỗng thường đi cùng yêu cầu làm rõ hoặc planner lỗi.
    tasks: SellerQuestionTask[];
    // Câu hỏi trả lại người dùng khi status là NEEDS_CLARIFICATION; các trạng thái khác để null.
    clarificationQuestion: string | null;
    // Chỉ có giá trị khi planner thất bại kỹ thuật hoặc trả dữ liệu không hợp lệ; không dùng cho câu hỏi ngoài phạm vi.
    failureReason: SellerQuestionPlannerFailure | null;
}

// Một lượt lịch sử tối giản đưa vào planner để hiểu ngữ cảnh; chỉ mang vai trò và nội dung, không mang ID tenant.
export interface SellerQuestionHistoryMessage {
    // Nguồn phát biểu trong hội thoại để planner phân biệt điều người bán hỏi và câu trả lời trước đó.
    role: 'user' | 'assistant';
    // Nội dung đã được giới hạn độ dài và che các định danh phổ biến trước khi gửi tới model.
    content: string;
}

// Đầu vào use case hiểu câu hỏi; caller chịu trách nhiệm xác thực quyền và chỉ truyền lịch sử thuộc hội thoại hợp lệ.
export interface SellerQuestionUnderstandingInput {
    // Tin nhắn hiện tại cần phân loại; đây là trọng tâm, lịch sử chỉ giúp diễn giải câu nối tiếp.
    question: string;
    // Lịch sử gần đây tùy chọn; planner không nhận ownerId/shopId nên không thể tự chọn tenant hoặc cấp quyền.
    history?: SellerQuestionHistoryMessage[];
    // Tín hiệu hủy nội bộ để dừng lời gọi planner khi trình duyệt đóng stream; không phải dữ liệu hội thoại/API.
    signal?: AbortSignal;
}

// Phần kỳ vọng tối thiểu cho mỗi task trong bộ đánh giá; không cần chấm lại cách model diễn đạt câu hỏi.
export interface SellerQuestionTaskExpectation {
    // Mục đích cần phân loại đúng, tách riêng khỏi chủ đề để giảm nhầm lẫn giữa hai khái niệm.
    requestType: SellerQuestionTask['requestType'];
    // Domain mong đợi; so sánh độc lập để phát hiện chọn sai loại nội dung/nguồn.
    domain: string | null;
    // Anchor là dữ kiện cụ thể cần được giữ (như tên đối tượng/khoảng thời gian), không phải từ đồng nghĩa của ý định vì evaluator so khớp chuỗi chính xác.
    resolvedQuestionMustContain?: string[];
}

// Một ca kiểm thử chuẩn để đo chất lượng planner trên câu mới, câu nối tiếp và yêu cầu nhiều ý.
export interface SellerQuestionEvaluationCase {
    // ID ổn định giúp truy vết và báo cáo đúng ca bị phân loại sai.
    id: string;
    // Câu người dùng cần đánh giá, giữ nguyên cách diễn đạt tự nhiên.
    question: string;
    // Tập dữ liệu dùng để phát triển prompt hoặc xác nhận độc lập; holdout không được dùng lặp để tinh chỉnh.
    split?: 'development' | 'realistic' | 'boundary-stress' | 'holdout';
    // Chỉ nhãn được nghiệp vụ duyệt mới đủ điều kiện làm bằng chứng cho ngưỡng chất lượng.
    reviewStatus?: 'PENDING_REVIEW' | 'APPROVED';
    // Lý do ngắn vì sao nhãn kỳ vọng phù hợp; bắt buộc khi reviewStatus là APPROVED.
    labelRationale?: string;
    // Ngữ cảnh giả lập tùy chọn để đánh giá khả năng nối câu hỏi với các lượt trước.
    history?: SellerQuestionHistoryMessage[];
    expected: {
        // Kết quả mong đợi; chỉ gồm trạng thái phân loại, không đưa lỗi provider vào bài đo ngữ nghĩa.
        status: Extract<
            SellerQuestionPlanStatus,
            'READY' | 'NEEDS_CLARIFICATION' | 'OUT_OF_SCOPE'
        >;
        // Quan hệ ngữ cảnh mà model cần nhận diện trong ca này.
        contextRelation: SellerContextRelation;
        // Intent/domain mong đợi theo đúng thứ tự người dùng nêu trong câu hỏi.
        tasks: SellerQuestionTaskExpectation[];
    };
}
