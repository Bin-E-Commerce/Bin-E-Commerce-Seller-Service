---
documentId: returns-refunds-policy
title: Quy trình yêu cầu trả hàng và hoàn tiền
domain: returns-refunds
language: vi
version: 2026.09.30
status: published
effectiveFrom: 2026-09-30
effectiveTo:
sourceType: internal-implementation
sourceRef: order-service/returns
---

# Quy trình yêu cầu trả hàng và hoàn tiền

## Phạm vi

Tài liệu này mô tả luồng trả hàng đang được triển khai trong Order Service và
cách dịch vụ này phối hợp với Shipping Service để báo phí, tạo vận đơn chiều
ngược, nhận hàng và lưu số tiền hoàn dự kiến. Đây là mô tả hành vi của hệ thống,
không thay thế chính sách đổi trả chính thức của sàn hay quy định pháp luật.

Điểm cần phân biệt: yêu cầu trả hàng, vận chuyển hàng quay về shop và giao dịch
hoàn tiền là ba phần liên quan nhưng không đồng nghĩa. Trạng thái yêu cầu cho biết
đang ở bước nào trong workflow; riêng `REFUND_PENDING` có nghĩa là chờ xử lý hoàn,
không tự xác nhận tiền đã được chuyển đến người mua.

## Điều kiện và cách gửi yêu cầu

Người mua có thể tạo yêu cầu khi đơn đã giao (`DELIVERED`) hoặc hoàn tất
(`COMPLETED`). Nếu đơn có `returnWindowUntil`, hệ thống từ chối yêu cầu sau mốc
này. Nếu đơn không có mốc đó, kiểm tra thời hạn này không được áp dụng; không nên
tự suy ra một số ngày chung cho mọi đơn.

Mỗi yêu cầu phải chọn ít nhất một sản phẩm thuộc đơn hàng và chỉ được gom sản
phẩm của cùng một shop. Với các lý do hàng bị hỏng, giao sai, thiếu hàng hoặc
không đúng mô tả, request cần ít nhất một ảnh bằng chứng. API nhận tối đa 5 ảnh
và 1 video; phần mô tả dài tối đa 1.000 ký tự. Các lý do được hỗ trợ là:

- `DAMAGED`: sản phẩm bị hư hỏng;
- `WRONG_ITEM`: giao sai sản phẩm;
- `MISSING_ITEM`: thiếu sản phẩm;
- `NOT_AS_DESCRIBED`: sản phẩm không đúng mô tả;
- `CHANGE_OF_MIND`: người mua đổi ý;
- `OTHER`: lý do khác.

Trong cùng một đơn và shop, nếu đã có yêu cầu đang được xử lý thì hệ thống trả lại
yêu cầu đó thay vì tạo workflow đang hoạt động thứ hai. Yêu cầu đã bị từ chối
hoặc người mua chủ động hủy không được tính là yêu cầu đang hoạt động.

## Các bước xử lý

1. Người mua gửi yêu cầu cho sản phẩm đã chọn; hệ thống lưu lý do, bằng chứng và
   snapshot tiền hoàn ban đầu ở trạng thái `REQUESTED`.
2. Seller xem yêu cầu thuộc shop của mình rồi chấp thuận hoặc từ chối. Khi chấp
   thuận, yêu cầu chuyển thẳng sang `AWAITING_SHIPMENT` để chờ tạo vận đơn chiều
   ngược; `APPROVED` là quyết định xử lý, không phải trạng thái trung gian được
   lưu trong luồng này. Khi từ chối, trạng thái là `REJECTED`; seller phải ghi
   lý do từ chối tối thiểu 10 ký tự.
3. Sau khi chấp thuận, Shipping Service tạo vận đơn loại `RETURN`, gửi hàng từ
   địa chỉ người mua về địa chỉ shop. Order Service đồng bộ trạng thái giao nhận
   vào yêu cầu, thường từ `AWAITING_SHIPMENT` sang `IN_TRANSIT`, rồi
   `RECEIVED` khi shop nhận được hàng. Lỗi giao nhận có thể được thể hiện bằng
   `SHIPMENT_FAILED`.
4. Khi hàng đã ở `RECEIVED`, seller ghi nhận kết quả kiểm tra. Nếu đạt, yêu cầu
   chuyển sang `REFUND_PENDING` và hệ thống phát sự kiện ghi nhận các sản phẩm đã
   trả. Nếu không đạt, yêu cầu chuyển sang `INSPECTION_FAILED`; trạng thái này
   không có nghĩa là tiền đã được hoàn.

Người mua chỉ được hủy yêu cầu khi trạng thái còn `REQUESTED`, tức seller chưa
xử lý. Sau khi seller đã chấp thuận hoặc từ chối, API hủy yêu cầu sẽ không còn
chấp nhận thao tác này.

## Phí vận chuyển và số tiền hoàn

Khi tạo yêu cầu, hệ thống lấy phí vận chuyển chiều ngược từ Shipping Service
(quote cho vận đơn `RETURN`) dựa trên shop, địa chỉ nhận hàng và thông tin kiện
hàng của các sản phẩm đã chọn. Không có quote hợp lệ thì không thể coi phí là 0;
hệ thống báo lỗi thay vì tạo một snapshot thiếu phí. Khi nhận được chi phí vận
chuyển thực tế, snapshot của yêu cầu còn đang xử lý được cập nhật lại.

Các thành phần được lưu riêng:

- `refundItemAmount`: tổng `lineTotal` của các sản phẩm được chọn;
- `refundShippingAmount`: phần phí giao chiều đi được tính hoàn nếu lý do thuộc
  nhóm lỗi seller;
- `returnShippingCost`: chi phí vận chuyển chiều ngược được báo;
- `returnShippingFee`: phần chi phí chiều ngược khấu trừ vào khoản hoàn của người
  mua;
- `refundAmount`: số tiền hoàn dự kiến sau khi cộng/trừ các thành phần trên.

Nhóm lý do được hệ thống xem là lỗi seller gồm `DAMAGED`, `WRONG_ITEM`,
`MISSING_ITEM` và `NOT_AS_DESCRIBED`. Với nhóm này, phí gửi hàng chiều ngược mà
người mua phải chịu được đặt bằng 0; hệ thống cũng có thể tính phần phí giao
chiều đi tương ứng với giá trị sản phẩm trả. Với `CHANGE_OF_MIND` hoặc `OTHER`,
phần phí giao chiều đi không được cộng hoàn theo quy tắc lỗi seller, còn phí gửi
chiều ngược theo quote được khấu trừ vào khoản hoàn.

Cách tính tổng quát trong workflow hiện tại:

`refundAmount = max(0, refundItemAmount + refundShippingAmount - returnShippingFee)`

Số tiền được giới hạn không vượt quá tổng tiền đơn hàng. Nếu phí giao chiều đi
của đơn nhiều shop có breakdown theo shop, phần hoàn được phân bổ theo tỷ trọng
giá trị sản phẩm trả so với giá trị sản phẩm của shop đó; nếu không có breakdown,
hệ thống dùng tổng phí và subtotal của đơn làm cơ sở. Các giá trị tiền được làm
tròn theo quy tắc VND của Order Service.

Đây là snapshot tính toán cho request; nó không tự quyết định tranh chấp hoặc
thay thế kết quả kiểm tra hàng của seller. Với câu hỏi về một đơn cụ thể, chỉ
nêu khoản tiền khi có dữ liệu chi tiết của chính request đó; không suy ra từ số
lượng yêu cầu hoàn đang chờ trên dashboard.

## Hủy đơn, phí và thời điểm nhận tiền

Hủy đơn trước khi giao và trả hàng sau khi đã nhận là hai quy trình khác nhau.
Không áp dụng công thức của yêu cầu trả hàng để kết luận mọi khoản phí của một
đơn bị hủy sẽ được hoàn. Cần xem trạng thái đơn, phương thức thanh toán và dữ
liệu đối soát tương ứng trước khi khẳng định số tiền.

Trong luồng trả hàng, sau khi seller xác nhận hàng đạt, trạng thái mới là
`REFUND_PENDING`. Mã trạng thái `REFUNDED` hoặc `REFUND_FAILED` có trong tập enum,
nhưng chỉ sự hiện diện của enum không chứng minh giao dịch thanh toán đã hoàn
tất hoặc đã thất bại. Không hứa ngày tiền về hay nói tiền đã vào tài khoản
nếu không có kết quả giao dịch/đối soát thực tế từ nguồn thanh toán.

## Cách BinGPT nên trả lời

- Giải thích trực tiếp: ai đang ở bước nào, bước tiếp theo do người mua, seller
  hay đơn vị vận chuyển thực hiện.
- Khi hỏi “phí trả hàng ai chịu?”, nêu rõ điều kiện theo lý do: bốn lý do lỗi
  seller được miễn phần phí vận chuyển chiều ngược cho người mua; các lý do còn
  lại có thể bị khấu trừ theo quote. Không trả lời tuyệt đối nếu chưa biết lý do
  và snapshot của request.
- Khi hỏi “đã hoàn tiền chưa?”, phân biệt `REFUND_PENDING` với giao dịch hoàn
  thành công. Muốn xác nhận tiền đã về cần đọc trạng thái giao dịch/đối soát,
  không chỉ đọc trạng thái yêu cầu trả hàng.
- Khi hỏi số tiền hoặc tiến độ của một yêu cầu cụ thể, chỉ trả lời từ dữ liệu
  chi tiết đúng request. Nếu nguồn live chưa cung cấp chi tiết đó cho BinGPT, nói
  rõ hiện chưa tra được request cụ thể và hướng dẫn seller mở mục Trả hàng/Hoàn
  tiền trong Seller Center.
- Không tự đặt thời hạn đổi trả chung, thời gian hoàn tiền, mức phí cố định hay
  kết quả xử lý cho một đơn nếu không có nguồn tương ứng.

## Nguồn dữ liệu và giới hạn

Quy tắc trong tài liệu được đối chiếu với `OrderReturnService`, DTO và enum trạng
thái trả hàng của Order Service, cùng luồng quote/tạo vận đơn chiều ngược của
Shipping Service. Đây là nguồn mô tả workflow hiện tại.

Seller Copilot có thể truy xuất knowledge về quy trình chung, nhưng hiện chưa có
nguồn live để tra chi tiết từng return request và giao dịch thanh toán/đối soát.
Vì vậy BinGPT có thể giải thích cách hệ thống xử lý, nhưng không được tự nhận đã
đọc hồ sơ của một đơn cụ thể, không suy đoán số tiền thực nhận, và không khẳng
định giao dịch ngân hàng đã hoàn tất nếu chưa có evidence live.
