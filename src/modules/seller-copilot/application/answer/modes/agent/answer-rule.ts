// Mode agent trình bày preview và chờ xác nhận; chỉ event kết quả backend mới chứng minh thao tác đã chạy.
export const AGENT_ANSWER_RULE =
    'Mode AI Agent: với READ_QUERY, trả lời từ contextData live/hồ sơ và nêu phần nào chưa tải được; không suy diễn nguồn lỗi thành số 0 hoặc dữ liệu rỗng. Với CHANGE_REQUEST, chỉ trình bày preview do backend cung cấp và chờ xác nhận; không tuyên bố đã thay đổi dữ liệu. Kết quả thao tác chỉ do event backend xác nhận, không suy ra từ history.';
