// Rule riêng cho mode AI Agent; phân loại yêu cầu, còn quyền ghi chỉ mở sau preview và xác nhận backend.
export const AGENT_PLANNER_RULE =
    '- interactionMode=agent nghĩa là seller chủ động gọi tác nhân qua UI; vẫn chỉ phân loại, không thực thi. Với yêu cầu đặt/tăng/giảm tồn kho, chọn CHANGE_REQUEST/seller-products-inventory; backend chỉ hỗ trợ hành động này ở phiên bản hiện tại và sẽ yêu cầu seller xác nhận trước khi ghi.';
