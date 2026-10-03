---
documentId: shipping-policy
title: Vận hành giao nhận và quản lý địa chỉ lấy hàng
domain: shipping
language: vi
version: 2026.09.30
status: published
effectiveFrom: 2026-09-30
effectiveTo:
sourceType: internal-implementation
sourceRef: seller-service/shop-shipping-settings, shipping-service, order-service
---

# Vận hành giao nhận và quản lý địa chỉ lấy hàng

## Phạm vi tài liệu

Tài liệu này mô tả cách hệ thống hiện tại quản lý địa chỉ lấy hàng, cấu hình
giao nhận, kiểm tra điều kiện sẵn sàng, tính quote và theo dõi vận đơn.

Có hai loại dữ liệu cần phân biệt:

- **Cấu hình shop**: đọc live từ Seller Service, gồm thời gian chuẩn bị, khung
  giờ lấy hàng, bật/tắt giao hàng và địa chỉ mặc định.
- **Trạng thái vận đơn**: được lưu và đồng bộ tại Shipping Service từ provider
  `GHN_TEST` hoặc từ chế độ demo local.

Các giá trị trong tài liệu này giải thích quy tắc chung. Khi seller hỏi “hiện
tại shop của tôi đang cấu hình thế nào” hoặc “vận đơn này đang ở đâu”, BinGPT
phải ưu tiên dữ liệu live, không lấy giá trị mặc định trong tài liệu để trả lời.

## Cấu hình giao nhận của shop

Seller có thể quản lý các thông tin sau trong nhóm Seller Shipping:

- bật hoặc tắt giao hàng (`enabled`);
- thời gian chuẩn bị đơn (`preparationTimeHours`);
- khung giờ dự kiến đơn vị vận chuyển đến lấy hàng
  (`pickupWindowStart`, `pickupWindowEnd`);
- danh sách địa chỉ lấy hàng;
- địa chỉ lấy hàng mặc định (`defaultPickupAddressId`).

Khi chưa có bản ghi cấu hình, hệ thống khởi tạo giá trị kỹ thuật mặc định là 24
giờ chuẩn bị hàng, khung giờ `08:00–18:00` và bật giao hàng. Đây chỉ là giá trị
khởi tạo cho shop cũ, **không phải SLA hoặc cam kết thời gian áp dụng cho mọi
đơn**.

## Địa chỉ lấy hàng

Địa chỉ lấy hàng mặc định được dùng khi hệ thống báo giá hoặc tạo vận đơn cho
shop. Một địa chỉ đầy đủ phải có:

| Nhóm thông tin    | Trường dùng trong hệ thống           | Mục đích                               |
| ----------------- | ------------------------------------ | -------------------------------------- |
| Liên hệ           | Tên người liên hệ, số điện thoại     | Đơn vị vận chuyển liên hệ khi lấy hàng |
| Địa giới hiển thị | Tỉnh/thành, quận/huyện, phường/xã    | Hiển thị và định vị địa chỉ            |
| Mã GHN            | Mã tỉnh, mã quận/huyện, mã phường/xã | Resolve địa chỉ và tính quote          |
| Vị trí cụ thể     | Địa chỉ chi tiết                     | Xác định nơi shipper đến lấy           |

Seller có thể thêm, sửa, chọn mặc định hoặc xóa địa chỉ thuộc shop hiện tại.
Khi tạo địa chỉ đầu tiên, hệ thống tự chọn địa chỉ đó làm mặc định. Nếu shop
chưa có địa chỉ thủ công, hệ thống có thể đồng bộ địa chỉ hợp lệ từ hồ sơ
onboarding lần đầu; địa chỉ seller đã chủ động xóa sẽ không tự khôi phục lại.

Khi chọn địa chỉ mặc định mới, hệ thống bỏ cờ mặc định ở các địa chỉ khác và cập
nhật `defaultPickupAddressId`. Khi xóa địa chỉ mặc định:

- nếu shop còn sản phẩm đang đăng bán, hệ thống yêu cầu chọn địa chỉ khác trước;
- nếu còn địa chỉ khác và được phép thay thế, địa chỉ tạo sớm nhất được chọn;
- nếu không còn địa chỉ, cấu hình mặc định trở thành `null` và shop phải tạo địa
  chỉ mới trước khi sẵn sàng giao hàng.

Mọi thao tác đều kiểm tra `shopId` từ user context hoặc internal service context;
browser không được tự chọn shop khác để đọc hoặc sửa địa chỉ.

## Điều kiện sẵn sàng giao nhận

Seller Service kiểm tra readiness theo thứ tự cố định:

1. Shop phải có ít nhất một địa chỉ lấy hàng.
2. Thiết lập giao hàng phải đang bật.
3. Shop phải có địa chỉ mặc định trong settings hoặc cờ mặc định hợp lệ.
4. Địa chỉ mặc định phải đủ liên hệ, địa chỉ chi tiết và mã địa giới GHN.
5. Nếu tất cả điều kiện đạt, shop được xem là sẵn sàng giao nhận.

Readiness trả về một trong các lý do sau:

| Mã nội bộ                   | Diễn giải cho seller                             |
| --------------------------- | ------------------------------------------------ |
| `NO_PICKUP_ADDRESS`         | Shop chưa có địa chỉ lấy hàng                    |
| `SHIPPING_DISABLED`         | Thiết lập giao hàng đang tắt                     |
| `NO_DEFAULT_PICKUP_ADDRESS` | Shop chưa chọn địa chỉ lấy hàng mặc định         |
| `INCOMPLETE_PICKUP_ADDRESS` | Địa chỉ mặc định còn thiếu thông tin hoặc mã GHN |
| `READY`                     | Shop đã đủ điều kiện giao nhận                   |

BinGPT phải diễn giải mã bằng tiếng Việt. Nếu nhiều điều kiện cùng thiếu, kết
quả được trả theo nguyên nhân đầu tiên trong thứ tự trên.

## Báo giá phí vận chuyển

Trong checkout, Order Service gom item theo từng shop rồi gửi quote đến Shipping
Service. Pickup address luôn được Shipping Service lấy server-side từ địa chỉ
mặc định của shop; client không được gửi địa chỉ nguồn tùy ý.

Quote dùng các dữ liệu:

- địa chỉ lấy hàng của shop và địa chỉ nhận của khách;
- khối lượng, chiều dài, chiều rộng và chiều cao kiện hàng;
- giá trị hàng;
- số tiền COD.

Provider hiện tại là `GHN_TEST`, dùng service tiêu chuẩn và có thể trả các thành
phần như phí cơ bản, phí giá trị khai báo, phí vùng xa, phí COD, phí giao lại
hoặc phí đồng kiểm. Tổng quote được lưu vào order cùng breakdown tại thời điểm
checkout. Phí này là phí của quote giao hàng; tài liệu này không tự suy ra
commission hoặc phí nền tảng của seller.

Nếu quote chiều đi không thể thực hiện vì thiếu mã GHN, thiếu thông tin đóng gói,
địa chỉ không hợp lệ hoặc provider không sẵn sàng, hệ thống trả lỗi thay vì dùng
một mức phí mặc định.

## Luồng tạo và theo dõi vận đơn

Seller chỉ tạo được vận đơn cho order đã `CONFIRMED`, có item thuộc shop hiện
tại, package data hợp lệ và có pickup address mặc định. Tạo vận đơn được xử lý
idempotent theo order/shop để retry không sinh hai vận đơn cho cùng một shop.

Vận đơn chiều giao có các trạng thái canonical:

| Trạng thái        | Ý nghĩa                        |
| ----------------- | ------------------------------ |
| `READY_TO_SHIP`   | Shop đang chuẩn bị hàng        |
| `PICKUP_ASSIGNED` | Đã phân công shipper đến lấy   |
| `PICKED_UP`       | Đơn vị vận chuyển đã lấy hàng  |
| `IN_TRANSIT`      | Kiện hàng đang được vận chuyển |
| `DELIVERED`       | Giao hàng thành công           |
| `FAILED`          | Giao hàng thất bại             |
| `CANCELLED`       | Vận đơn đã hủy                 |

Trạng thái được đồng bộ từ provider qua webhook hoặc polling và lưu event để có
thể xem lịch sử. Shipping Service không cho phép chuyển trạng thái lùi tùy ý;
forward shipment đi theo thứ tự giao nhận hợp lệ.

## Luồng hoàn hàng

Vận đơn hoàn là một shipment riêng có `shipmentKind = RETURN`, đi theo chiều từ
địa chỉ khách về pickup address của shop. Shipping Service dùng phí quote chiều
ngược và không dùng lại phí chiều đi.

Trạng thái vận đơn hoàn gồm:

`READY_TO_SHIP → PICKUP_ASSIGNED → PICKED_UP → IN_TRANSIT → RETURNING → RETURNED`

Khi vận đơn hoàn kết thúc ở `RETURNED`, Order Service được đồng bộ để request
return chuyển sang bước seller tiếp nhận/kiểm tra. Phí hoàn và số tiền refund
được giải thích trong tài liệu đổi trả; không lấy trạng thái vận đơn để kết luận
đã chuyển tiền hoàn cho khách.

## Chế độ GHN Test và demo

Provider hiện tại bị giới hạn ở GHN Test; hệ thống không cho dùng `GHN_BASE_URL`
production trong phase này. Khi `SHIPPING_DEMO_MODE` bật, một số forward/reverse
shipment có thể chạy theo chuỗi trạng thái demo để kiểm thử UI, event và state
machine. Trạng thái demo không phải bằng chứng về ETA hoặc SLA thực tế của hãng
vận chuyển.

## Những điều chưa được cam kết

Từ dữ liệu hiện tại, BinGPT không được tự khẳng định:

- phí cố định cho mọi đơn hoặc mọi khu vực;
- ETA hoặc thời gian giao chính xác nếu provider không trả
  `estimatedDeliveryAt`;
- SLA seller phải bàn giao hàng trong bao lâu ngoài giá trị cấu hình live;
- commission, phí nền tảng hoặc phí seller phải trả ngoài quote giao hàng;
- kết quả giao hàng nếu chưa có trạng thái vận đơn live.

Nếu seller hỏi “shop hiện đã sẵn sàng giao hàng chưa”, hãy đọc readiness live. Nếu
hỏi “thời gian chuẩn bị hoặc khung giờ lấy hàng hiện tại là bao nhiêu”, hãy đọc
live settings. Nếu hỏi phí hoặc ETA của một đơn cụ thể, cần có quote/order/
shipment evidence tương ứng; không dùng tài liệu tổng quan thay cho dữ liệu đó.
