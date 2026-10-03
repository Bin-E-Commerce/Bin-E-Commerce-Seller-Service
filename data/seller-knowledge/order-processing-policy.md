---
documentId: order-processing-policy
title: Quy trình nhận và xử lý đơn hàng của Seller
domain: order-processing
language: vi
version: 2026.09.30
status: published
effectiveFrom: 2026-09-30
effectiveTo:
sourceType: internal-implementation
sourceRef: order-service/checkout-and-seller-orders; shipping-service/shipments
---

# Quy trình nhận và xử lý đơn hàng của Seller

## Phạm vi Seller Center

Seller có thể xem danh sách và chi tiết các đơn có sản phẩm thuộc shop của mình,
tìm theo mã đơn, lọc theo trạng thái, xem vận đơn và tạo hoặc cập nhật vận đơn
qua luồng giao nhận. Danh sách được phân trang; đây không phải dữ liệu toàn bộ
shop khác trong cùng đơn.

Một order có thể chứa sản phẩm từ nhiều shop. Seller chỉ xem các dòng hàng và
tổng tiền thuộc shop mình; mỗi cặp order/shop được quản lý bằng vận đơn chiều đi
riêng. Vì vậy cùng một order number có thể liên quan đến nhiều seller và nhiều
vận đơn độc lập.

## Đơn được tạo như thế nào

Luồng checkout hiện hỗ trợ COD. Khi người mua đặt đơn, Order Service kiểm tra
giỏ hàng và địa chỉ giao hàng thuộc người mua; Product Service xác nhận giá, dữ
liệu biến thể và giữ tồn khả dụng; sau đó Shipping Service báo phí giao hàng và
Order Service lưu order cùng snapshot sản phẩm/tiền. Đơn mới được tạo với
`status = CONFIRMED`, `fulfillmentStatus = TO_SHIP` và
`paymentStatus = COD_PENDING_COLLECTION`.

Tồn được giữ trước khi order được lưu. Nếu báo phí giao hàng hoặc lưu order thất
bại, hệ thống cố gắng giải phóng reservation để không giữ tồn sai. Checkout có
idempotency key: gửi lại cùng key và cùng nội dung sẽ trả lại order cũ thay vì
tạo đơn hoặc giữ tồn lần nữa; dùng lại key với nội dung khác sẽ bị từ chối.

Sau khi order đã lưu, việc dọn giỏ hàng là bước best-effort; lỗi dọn giỏ không
đảo ngược order đã tạo thành công. Không nên kết luận checkout thất bại chỉ vì
giỏ vẫn còn dữ liệu nếu order đã được ghi nhận.

## Các bước seller xử lý

1. **Mở đúng đơn và kiểm tra phần hàng của shop.** Xác minh sản phẩm, biến thể,
   số lượng, địa chỉ nhận và thông tin gói hàng trong chi tiết đơn. Với đơn nhiều
   shop, chỉ xử lý các dòng hàng thuộc shop mình.
2. **Chuẩn bị kiện và tạo vận đơn.** Seller cần có địa chỉ lấy hàng mặc định hợp
   lệ; dữ liệu đóng gói của sản phẩm phải đủ để báo/tạo vận đơn. Shipping Service
   kiểm tra order đã được xác nhận và tạo vận đơn chiều đi cho shop hiện tại.
   Nếu vận đơn của cặp order/shop đã tồn tại, thao tác tạo lại trả về vận đơn đó
   thay vì tạo trùng.
3. **Theo dõi vận chuyển.** Trạng thái vận đơn do Shipping Service/đơn vị vận
   chuyển cập nhật. Seller có thể yêu cầu làm mới tracking; thao tác refresh đọc
   trạng thái mới từ nhà vận chuyển, không tự ép order tiến sang bước tiếp theo.
4. **Xử lý sau giao.** Khi đơn vị vận chuyển báo đã giao, fulfillment chuyển
   sang `DELIVERED` và chờ người mua xác nhận hoặc báo sự cố. Người mua xác nhận,
   hoặc worker tự hoàn tất sau deadline ba ngày, sẽ đưa đơn sang `COMPLETED`.

Trạng thái chuẩn và ý nghĩa từng mã được mô tả trong
`order-status-policy.md`. Không đồng nhất `status = CONFIRMED` với việc seller
đã tạo vận đơn, hàng đã được lấy, hoặc người mua đã nhận hàng.

## Hủy đơn và hủy vận đơn

Luồng hủy order chỉ chấp nhận order còn `status = CONFIRMED` và
`fulfillmentStatus = TO_SHIP`. Khi hủy thành công, Order Service đặt order và
fulfillment thành `CANCELLED`, lưu lý do và giải phóng tồn đã giữ. Seller phải
nhập lý do hủy.

Nếu vận đơn đã được tạo, Shipping Service chỉ cho hủy khi trạng thái vận đơn còn
`READY_TO_SHIP` hoặc `PICKUP_ASSIGNED` — tức hãng vận chuyển chưa lấy kiện. Dịch
vụ đồng bộ việc hủy vận đơn với Order Service; nếu hãng đã lấy hàng, thao tác hủy
bị từ chối. Không hướng dẫn seller hủy order theo luồng này khi fulfillment đã
`SHIPPING`, `DELIVERED` hoặc `COMPLETED`.

Lỗi giao hàng, báo sự cố sau khi giao và trả hàng là các nhánh khác nhau, không
tự động đồng nghĩa với hủy order. Khi fulfillment là `RETURN_REFUND`, cần xem
delivery issue hoặc return request cụ thể. Quy trình và tiền hoàn được mô tả
trong `returns-refunds-policy.md`.

## Trạng thái vận đơn khác trạng thái order

Shipping Service lưu trạng thái chi tiết hơn order fulfillment. Ví dụ:

- `READY_TO_SHIP`: vận đơn được tạo, shop đang chuẩn bị;
- `PICKUP_ASSIGNED`: đã phân công người đến lấy;
- `PICKED_UP` / `IN_TRANSIT`: hãng đã nhận kiện/kiện đang vận chuyển;
- `DELIVERED`: hãng ghi nhận giao thành công;
- `FAILED`: hãng báo giao thất bại;
- `CANCELLED`: vận đơn đã được hủy hợp lệ.

Order Service ánh xạ các mốc này sang fulfillment tổng quát: hai trạng thái đầu
thường vẫn là `TO_SHIP`; `PICKED_UP` và `IN_TRANSIT` thành `SHIPPING`; các mốc
giao thành công, giao thất bại hoặc hủy được ghi nhận theo trạng thái fulfillment
tương ứng. Khi cần biết vị trí, tracking code hoặc sự kiện mới nhất, phải đọc
vận đơn; `fulfillmentStatus` chỉ là tóm tắt vòng đời order.

## Dashboard và câu hỏi “đơn nào cần xử lý trước?”

Dashboard cung cấp số lượng tổng hợp theo trạng thái, không phải danh sách đầy
đủ có deadline của từng đơn. Số đếm `pendingShipment`, `shipping`, `delivered`,
`completed`, `cancelled` và `returnRefund` dựa trên fulfillment. Trong
implementation hiện tại, `pendingConfirmation` lại đếm `OrderStatus.PENDING`,
trong khi checkout COD tạo trực tiếp `CONFIRMED`; không diễn giải KPI này thành
số đơn COD mới đang chờ Seller xác nhận nếu chưa kiểm tra dữ liệu cụ thể.

Dashboard và Copilot hiện không cung cấp SLA chính thức, hạn bàn giao cho từng
đơn, mức phạt chậm hay thuật toán ưu tiên queue. Khi được hỏi đơn nào cần xử lý
trước, BinGPT không được chọn tùy tiện đơn đầu danh sách hoặc bịa deadline. Có
thể nêu trạng thái đang có và khuyên Seller kiểm tra chi tiết đơn/vận đơn trong
Seller Center để xác định việc cần làm.

## Giới hạn trả lời của BinGPT

- Có thể giải thích quy trình chung, ý nghĩa trạng thái và số đếm dashboard nếu
  có evidence live tương ứng.
- Không khẳng định đã đọc toàn bộ danh sách đơn hoặc một đơn cụ thể nếu context
  hiện tại không chứa đúng order/detail/tracking đó.
- Không suy đoán giờ lấy hàng, ngày giao dự kiến, số lần giao lại, trách nhiệm
  bồi thường hoặc thời hạn xử lý nếu tracking/policy không cung cấp.
- `PAID` trong Order Service không chứng minh payout/đối soát seller đã về tài
  khoản; không biến trạng thái vận chuyển thành trạng thái thanh toán.
- Nếu seller hỏi phí commission, tiền thực nhận hoặc đối soát, dùng
  `fees-settlement-policy.md`; không suy từ tổng tiền order hoặc COD amount.
