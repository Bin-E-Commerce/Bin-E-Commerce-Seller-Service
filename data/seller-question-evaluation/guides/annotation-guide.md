# Hướng dẫn gán nhãn và duyệt dữ liệu Phase 1

File này quy định cách gán nhãn chung cho development, realistic, boundary-stress, five-routes và holdout. `cases/development-cases.json` dùng để chẩn đoán/tinh chỉnh; `cases/realistic-cases.json` bổ sung cách nói đời thường; `cases/boundary-stress-cases.json` tập trung vào câu tự nhiên dễ nhầm giữa các intent/domain gần nhau; `cases/five-routes-cases.json` kiểm tra riêng năm cổng trò chuyện, hồ sơ, dữ liệu live, tài liệu và agent. Các bộ này chỉ dùng chẩn đoán, không dùng làm holdout nghiệm thu. `cases/holdout-cases.json` phải độc lập, không được dùng để sửa prompt sau khi xem kết quả.

## Điều kiện để một ca được tính

- Mỗi ca cần `id` duy nhất, câu hỏi tự nhiên, `expected` đầy đủ và `reviewStatus` rõ ràng. Chỉ người duyệt nhãn mới đổi thành `APPROVED`; nhãn chưa được xác nhận phải giữ `PENDING_REVIEW`.
- Mỗi ca cần `labelRationale` nêu vì sao request type, domain, context relation, status và số/thứ tự task đúng. Rationale do kỹ thuật đề xuất không tự thay thế xác nhận của người nắm nghiệp vụ.
- Ca mơ hồ phải kỳ vọng `NEEDS_CLARIFICATION`; không ép chọn domain nếu thiếu thông tin.
- `resolvedQuestionMustContain` chỉ nên chứa dữ kiện cụ thể không được làm mất như tên sản phẩm, biến thể hoặc khoảng thời gian; không dùng cụm ý nghĩa có nhiều cách diễn đạt (ví dụ “số đơn”, “tồn”) vì evaluator kiểm tra chuỗi chính xác và sẽ báo sai khi model dùng từ đồng nghĩa.
- Không đưa dữ liệu cá nhân, thông tin đăng nhập hoặc nội dung hội thoại production chưa được ẩn danh.
- Holdout nên có biến thể cách nói, lỗi gõ, follow-up, câu nhiều ý và cặp gần nghĩa. Không tạo nhiều bản sao gần như giống nhau chỉ để tăng số lượng.

## Nhãn task

Mỗi task có `requestType`, `domain` và thứ tự theo ý người dùng:

- `SMALL_TALK`: trò chuyện xã giao, không cần domain.
- `CAPABILITY_QUERY`: hỏi BinGPT có hỗ trợ chức năng nào; domain thường là `seller-copilot-capabilities`.
- `READ_QUERY`: muốn xem/tra cứu/giải thích; domain nêu rõ chủ đề như `seller-profile`, `seller-revenue`, `seller-orders`, `seller-products-inventory` hoặc một domain tài liệu.
- `CHANGE_REQUEST`: yêu cầu tạo/cập nhật/xóa/thay đổi; chọn domain dữ liệu liên quan. Đây chỉ là ý định, không đồng nghĩa thao tác đã được cấp quyền hay thực hiện.
- `OUT_OF_SCOPE`: yêu cầu rõ ràng nằm ngoài hỗ trợ seller, domain phải là `null`.

## Ranh giới cần áp dụng nhất quán

- `CAPABILITY_QUERY` hỏi BinGPT hỗ trợ hoặc không hỗ trợ việc gì, kể cả hỏi về giới hạn. `CHANGE_REQUEST` yêu cầu thực hiện thay đổi ngay. Cách nói lịch sự như “giúp tôi được không?” không tự biến một yêu cầu thao tác thành câu hỏi capability.
- `READ_QUERY` hỏi dữ liệu, cách làm hoặc quy định. Phân domain theo nội dung cần tra: doanh thu tổng hợp của shop là `seller-revenue`; đơn cụ thể và số đơn là `seller-orders`; tồn kho, danh mục và sản phẩm bán chạy là `seller-products-inventory`; quy tắc ghi nhận doanh thu/phí là `fees-settlement`.
- `order-status` giải thích ý nghĩa trạng thái; `order-processing` mô tả việc shop cần làm với đơn; `shipping` nói về cấu hình giao nhận, địa chỉ lấy hàng và vận đơn. Câu hỏi về nội dung/lịch sử/khoản mục đối soát thuộc `fees-settlement`; chỉ hỏi đường dẫn menu hoặc vị trí màn hình cụ thể mới thuộc `seller-center-troubleshooting`.
- `CLARIFICATION_REPLY` chỉ dùng khi lượt assistant gần nhất vừa hỏi bổ sung/chọn lựa và user đang trả lời câu hỏi đó. Câu tiếp nối sau câu trả lời thông thường là `FOLLOW_UP`.
- Chỉ hỏi làm rõ khi thiếu thông tin khiến không thể chọn luồng hoặc domain an toàn. Không yêu cầu thêm chi tiết chỉ cần cho bước trả lời sau nếu domain đã rõ.
- Với nhiều ý, tạo một task cho mỗi yêu cầu độc lập, giữ đúng thứ tự; không tách một câu hỏi đơn thành nhiều task.

Ví dụ ba cách hỏi cùng domain tồn kho nhưng khác request type:

```json
[
    {
        "requestType": "CAPABILITY_QUERY",
        "domain": "seller-copilot-capabilities"
    },
    { "requestType": "READ_QUERY", "domain": "seller-products-inventory" },
    { "requestType": "CHANGE_REQUEST", "domain": "seller-products-inventory" }
]
```

Các ví dụ trên lần lượt tương ứng với “BinGPT có hỗ trợ tự động cập nhật tồn kho không?”, “Tồn kho còn bao nhiêu?” và “Cập nhật tồn kho lên 20”.

## Ngưỡng báo cáo

Evaluator yêu cầu tối thiểu 100 nhãn đã duyệt cho từng request type và từng domain. Nhóm thiếu mẫu được ghi `INSUFFICIENT_DATA`, không tính là đạt. Ngưỡng accuracy là **lớn hơn 97%**; report đồng thời lưu khoảng tin cậy 95%, tỷ lệ plan hợp lệ/lỗi kỹ thuật, model, hash prompt/registry, thời gian và token sử dụng.

Chạy kiểm tra nhãn mà không gọi model:

```powershell
npm run question-planner:evaluate -- --split=holdout --dry-run
```

Chạy benchmark holdout thật (có phát sinh chi phí API):

```powershell
npm run question-planner:evaluate -- --split=holdout
```

Chạy dry-run bộ câu hỏi đời thường để kiểm tra nhãn/cấu trúc:

```powershell
npm run question-planner:evaluate -- --split=realistic --dry-run
```

Chạy phân loại thật trên bộ realistic (gọi model một lần cho mỗi câu):

```powershell
npm run question-planner:evaluate -- --split=realistic
```

Các ca realistic hiện là nhãn đề xuất `PENDING_REVIEW`; report chỉ dùng chẩn đoán, không thể thay thế holdout hoặc được tính là nghiệm thu.

Chạy dry-run bộ câu có ranh giới intent/domain dễ nhầm:

```powershell
npm run question-planner:evaluate -- --split=boundary-stress --dry-run
```

Chạy planner thật trên bộ boundary-stress (mỗi câu gọi model một lần và có phát sinh chi phí API):

```powershell
npm run question-planner:evaluate -- --split=boundary-stress
```

Nhãn của boundary-stress cũng cần được người nắm nghiệp vụ duyệt; kết quả hiện chỉ có giá trị chẩn đoán, không phải holdout nghiệm thu.

Chạy dry-run bộ năm cổng để xác nhận nhãn và số lượng ca mà không gọi model:

```powershell
npm run question-planner:evaluate -- --split=five-routes --dry-run
```

Chạy planner thật trên 50 câu thuộc năm cổng (mỗi câu gọi model một lần và có phát sinh chi phí API):

```powershell
npm run question-planner:evaluate -- --split=five-routes
```

Report có accuracy và confusion matrix riêng cho `CONVERSATION`, `PROFILE`, `LIVE_DATA`, `KNOWLEDGE`, `AGENT_INVENTORY`. Bộ này giữ nhãn `PENDING_REVIEW`, chỉ phục vụ chẩn đoán; cần kiểm duyệt nghiệp vụ trước khi dùng nhãn làm gold data.
