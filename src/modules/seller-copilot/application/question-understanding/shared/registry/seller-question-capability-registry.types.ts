// Registry mô tả request type, domain và nguồn bằng chứng mà planner được phép gợi ý.
// Nó chỉ kiểm soát phân loại; backend vẫn tự xác thực tenant, quyền, dữ liệu và thao tác.

// Phân biệt domain lấy bằng chứng từ tài liệu, dữ liệu vận hành hoặc hồ sơ hiện tại.
export type SellerKnowledgeDomainKind =
    // Nội dung thuộc kho Seller Knowledge và có thể được tìm bằng luồng truy xuất tài liệu.
    | 'knowledge'
    // Số liệu thay đổi theo thời gian, phải lấy từ nguồn dữ liệu live thay vì tài liệu tĩnh.
    | 'live-data'
    // Hồ sơ tài khoản/shop hiện tại; backend phải giới hạn theo người dùng và shop đã xác thực.
    | 'profile';

// Một nhóm chủ đề mà planner có thể gắn vào task để phase sau chọn đúng loại nguồn dữ liệu.
export interface SellerQuestionDomainDefinition {
    // Mã ổn định dùng trong JSON registry, plan, validator và bộ lọc truy xuất; không phải nhãn hiển thị.
    code: string;
    // Tên dễ đọc dùng trong catalog/hướng dẫn cho model và báo cáo.
    label: string;
    // Loại nguồn dự kiến cho domain; giá trị này mô tả nguồn, không tự thực hiện truy vấn.
    kind: SellerKnowledgeDomainKind;
    // Giải thích phạm vi chủ đề để model phân biệt domain gần nghĩa với nhau.
    description: string;
    // Ví dụ ngôn ngữ tự nhiên do Admin quản lý giúp planner hiểu domain mới mà không cần sửa prompt/code.
    examples?: string[];
    // Cho biết domain có tài liệu làm căn cứ hay không; domain live/profile lấy dữ liệu từ hệ thống ứng dụng.
    documentBacked: boolean;
}

// Mô tả mục đích yêu cầu và domain hợp lệ; cặp này là allowlist nội bộ được kiểm tra ở runtime.
export interface SellerQuestionRequestTypeDefinition {
    // Mã phải khớp với contract SellerQuestionRequestType để validator chấp nhận task.
    code: string;
    // Tên dễ đọc dùng trong catalog, prompt và báo cáo đánh giá.
    label: string;
    // Ý nghĩa của request type, độc lập với domain mà người dùng đang hỏi.
    description: string;
    // Domain được phép kết hợp với loại yêu cầu này; danh sách rỗng yêu cầu domain null.
    domains: string[];
    // Ví dụ đối chiếu giúp model hiểu ranh giới ngữ nghĩa, không phải danh sách từ khóa đóng.
    examples: string[];
}

// Toàn bộ registry được nạp từ cấu hình khi khởi động, sau đó dùng chung cho prompt, schema và validate plan.
export interface SellerQuestionCapabilityRegistry {
    // Phiên bản cấu trúc JSON; validator hiện chỉ hỗ trợ version 1, nên thêm mục cùng schema không cần tăng version.
    // Chỉ đổi version khi có thay đổi cấu trúc và đồng thời cập nhật validator để hỗ trợ phiên bản mới.
    version: number;
    // Danh sách chủ đề và nguồn bằng chứng; task tham chiếu phải chọn domain tại đây.
    domains: SellerQuestionDomainDefinition[];
    // Danh sách loại yêu cầu và domain được phép kết hợp; phải đủ các request type chuẩn.
    requestTypes: SellerQuestionRequestTypeDefinition[];
}

// Planner đọc registry lúc xử lý từng câu để domain ACTIVE mới có hiệu lực ngay, không cần restart service.
export interface SellerQuestionCapabilityRegistryProvider {
    getActiveRegistry(): Promise<SellerQuestionCapabilityRegistry>;
}

// Token DI để service, loader và test cùng inject đúng một registry đã được kiểm tra.
export const SELLER_QUESTION_CAPABILITY_REGISTRY = Symbol(
    'SELLER_QUESTION_CAPABILITY_REGISTRY',
);
