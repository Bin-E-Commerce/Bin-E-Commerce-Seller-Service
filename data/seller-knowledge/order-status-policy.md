---
documentId: order-status-policy
title: Cách đọc trạng thái đơn hàng, giao nhận và thanh toán
domain: order-status
language: vi
version: 2026.09.30
status: published
effectiveFrom: 2026-09-30
effectiveTo:
sourceType: internal-implementation
sourceRef: order-service/order-lifecycle-and-delivery
---

# Cách đọc trạng thái đơn hàng, giao nhận và thanh toán

## Đọc đúng trường trạng thái

Một đơn có nhiều trạng thái độc lập, mỗi trường trả lời một câu hỏi khác nhau:

- `status`: vòng đời tổng thể của order;
- `fulfillmentStatus`: shop và đơn vị vận chuyển đang thực hiện đơn đến đâu;
- `paymentStatus`: Order Service đã ghi nhận tình trạng thu tiền nào;
- `deliveryConfirmation.status`: người mua đã xác nhận nhận hàng, báo vấn đề,
  hay hệ thống tự hoàn tất chưa;
- `returnRequest.status`: một yêu cầu trả hàng cụ thể đang ở bước nào.

Các trường này không thay thế lẫn nhau. Ví dụ, một đơn có thể giữ
`status = CONFIRMED` trong khi `fulfillmentStatus` đã là `SHIPPING` hoặc
`COMPLETED`. Từ riêng `status` không thể kết luận hàng đã giao hay tiền đã về
tài khoản seller.

## `status`: vòng đời tổng thể của order

| Giá trị     | Ý nghĩa theo code hiện tại                                                                                                                                                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PENDING`   | Giá trị được giữ cho workflow/phase khác. Luồng checkout COD hiện tại không tạo đơn ở trạng thái này.                                                                                                                    |
| `CONFIRMED` | Checkout COD thành công và tồn kho đã được giữ; đây là trạng thái order được tạo trong luồng hiện tại. Order thường giữ trạng thái này khi giao nhận tiến triển.                                                         |
| `FAILED`    | Trạng thái legacy/compatibility. Khi response của đơn cũ thiếu `fulfillmentStatus`, mapper có thể chuyển `FAILED` thành `DELIVERY_FAILED`; không nên xem đây là trạng thái vận chuyển mới nhất nếu có fulfillment riêng. |
| `CANCELLED` | Order đã bị hủy trong luồng hủy trước khi kiện được bàn giao cho vận chuyển.                                                                                                                                             |

## `fulfillmentStatus`: chuẩn bị, giao hàng và xử lý sau giao

| Giá trị           | Ý nghĩa và bước tiếp theo                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TO_SHIP`         | Đơn đã được checkout xác nhận, chờ shop chuẩn bị/tạo vận đơn/bàn giao. Các mốc vận chuyển `READY_TO_SHIP` và `PICKUP_ASSIGNED` vẫn được ánh xạ vào giai đoạn này.              |
| `SHIPPING`        | Shipper đã lấy hàng hoặc kiện đang vận chuyển; các mốc `PICKED_UP` và `IN_TRANSIT` được ánh xạ vào đây.                                                                        |
| `DELIVERED`       | Đơn vị vận chuyển báo giao thành công. Đơn chờ người mua xác nhận hoặc phản hồi sự cố; đây chưa phải `COMPLETED`.                                                              |
| `COMPLETED`       | Người mua xác nhận đã nhận hàng hoặc hệ thống tự hoàn tất sau hạn chờ xác nhận. Trong luồng COD hiện tại, Order Service đồng thời đổi `paymentStatus` sang `PAID`.             |
| `DELIVERY_FAILED` | Order Service đã nhận trạng thái giao hàng thất bại từ Shipping Service. Giá trị này tự nó không cho biết đơn đã hủy, hoàn tiền, hay lịch giao lại tiếp theo.                  |
| `CANCELLED`       | Đơn bị hủy trước khi được bàn giao cho shipper; khác với sự cố phát sinh sau khi giao hàng.                                                                                    |
| `RETURN_REFUND`   | Đơn đã chuyển sang nhánh xử lý sự cố sau giao hoặc trả hàng/hoàn tiền. Đây không phải trạng thái `CANCELLED`; kết quả chi tiết nằm ở delivery issue hoặc return request riêng. |

Luồng giao nhận thông thường:

`TO_SHIP → SHIPPING → DELIVERED → COMPLETED`

Đây là các giai đoạn thường gặp, không phải mọi đơn đều đi hết tuyến này. Sự
kiện lỗi có thể đưa fulfillment sang `DELIVERY_FAILED`; người mua báo sự cố sau
khi giao hoặc seller chấp thuận trả hàng có thể đưa order sang `RETURN_REFUND`.

## Xác nhận đã nhận hàng

Khi Shipping Service báo `DELIVERED`, Order Service lưu thời điểm giao và mở
trạng thái xác nhận riêng `deliveryConfirmation.status = PENDING`, kèm deadline
ba ngày từ thời điểm giao.

- Nếu người mua xác nhận đã nhận hàng trước deadline, fulfillment chuyển sang
  `COMPLETED`, confirmation thành `CONFIRMED` với method `CUSTOMER`.
- Nếu người mua không thao tác trước deadline, worker tự hoàn tất đơn; confirmation
  thành `AUTO_CONFIRMED` với method `AUTO`.
- Nếu người mua báo có vấn đề, confirmation thành `ISSUE_REPORTED` và fulfillment
  chuyển sang `RETURN_REFUND`; hệ thống ghi nhận delivery issue để tiếp tục xử lý.

Vì vậy `deliveryConfirmation.status = PENDING` nghĩa là đang chờ người mua phản
hồi sau giao hàng. Nó khác `order.status = PENDING`, vốn không được checkout COD
hiện tại dùng, và khác `returnRequest.status = REQUESTED`, vốn là yêu cầu trả hàng
đã được gửi.

## `paymentStatus`: trạng thái thu tiền trong luồng hiện tại

Checkout hiện hỗ trợ COD. Đơn mới được tạo với `paymentStatus =
COD_PENDING_COLLECTION`. Khi đơn chuyển sang `COMPLETED` do người mua xác nhận
hoặc worker tự hoàn tất, Order Service ghi `paymentStatus = PAID`.

Giá trị `REFUND_PENDING` có trong enum thanh toán, nhưng luồng return hiện tại
theo dõi bước chờ hoàn trên `returnRequest.status = REFUND_PENDING`; code xử lý
return không tự chuyển `order.paymentStatus` sang `REFUND_PENDING`. Trạng thái
return này cũng không chứng minh giao dịch đã được hoàn tất hoặc tiền đã về tài
khoản. Xem `returns-refunds-policy.md` để biết cách đọc return request và snapshot
tiền hoàn.

`PAID` là trạng thái được Order Service ghi nhận cho đơn COD sau khi hoàn tất; nó
không tự xác nhận seller đã nhận payout/đối soát vào tài khoản. Không suy luận
thời điểm tiền về seller từ fulfillment hoặc payment status của order.

## Hủy đơn và đơn giao thất bại

Luồng hủy hiện tại chỉ chấp nhận order `CONFIRMED` còn ở fulfillment `TO_SHIP`.
Khi hủy thành công, hệ thống giải phóng lượng tồn đã giữ, đặt cả order status và
fulfillment status thành `CANCELLED`, đồng thời lưu lý do. Seller phải cung cấp
lý do hủy. Khi đơn đã chuyển sang `SHIPPING`, không được dùng luồng hủy trước
giao hàng này.

`DELIVERY_FAILED` không đồng nghĩa `CANCELLED` và không tự mô tả kết quả xử lý
tiếp theo. Cần xem tracking/vận đơn và chi tiết đơn để biết thông tin mới nhất;
không tự hứa số lần giao lại, thời gian xử lý hoặc khoản hoàn nếu không có nguồn
live tương ứng.

## Số liệu dashboard và giới hạn tra cứu

Dashboard seller tổng hợp số lượng theo các trường trạng thái riêng: `TO_SHIP`
được hiển thị ở nhóm chờ giao/bàn giao, `SHIPPING` ở nhóm đang vận chuyển,
`DELIVERED` chờ xác nhận, `COMPLETED` đã hoàn tất, `CANCELLED` đã hủy và
`RETURN_REFUND` đang ở nhánh sự cố/hoàn trả. Các số đếm là snapshot tổng hợp, không
phải lịch sử chuyển trạng thái của một đơn cụ thể.

Trong implementation hiện tại, KPI `pendingConfirmation` của dashboard được
đếm từ `order.status = PENDING`, trong khi checkout COD mới tạo order trực tiếp
ở `CONFIRMED`. Vì vậy không diễn giải KPI này thành tổng số đơn đang chờ shop
xác nhận nếu chưa kiểm tra định nghĩa/nguồn live của widget đó.

Nếu seller hỏi về một đơn cụ thể, cần resolve đúng order từ order number/ID hoặc
ngữ cảnh đã xác định và đọc `status`, `fulfillmentStatus`, `paymentStatus` cùng
tracking/return state liên quan. Không lấy trạng thái của một đơn khác hoặc số
đếm dashboard để kết luận tiến độ của đơn này.

## Quy tắc trả lời của BinGPT

- Nêu rõ đang nói về trạng thái order, giao nhận, thu tiền, xác nhận nhận hàng
  hay return request; tránh dịch chung các mã `PENDING`.
- Khi seller hỏi “đơn đã giao chưa?”, ưu tiên `fulfillmentStatus`, không dùng
  `status = CONFIRMED` để kết luận.
- Khi hỏi “đã hoàn thành chưa?”, phân biệt `DELIVERED` với `COMPLETED` và nêu
  trạng thái xác nhận khách nếu dữ liệu có.
- Khi hỏi “đã thanh toán/đã nhận tiền chưa?”, báo đúng trường và chủ thể: Order
  Service ghi nhận `PAID` cho COD sau hoàn tất, nhưng trạng thái này không chứng
  minh payout/đối soát seller đã về tài khoản.
- Khi gặp `RETURN_REFUND`, không gọi là đã hủy; kiểm tra delivery issue hoặc
  return request để nói đúng việc còn chờ.
- Không tự thêm SLA, số lần giao lại, lý do thất bại hoặc ngày tiền về nếu nguồn
  trạng thái/tracking không cung cấp.
