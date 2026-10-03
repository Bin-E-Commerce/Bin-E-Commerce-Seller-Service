---
documentId: fees-settlement-policy
title: Phí vận chuyển, COD và cách ghi nhận doanh thu
domain: fees-settlement
language: vi
version: 2026.09.30
status: published
effectiveFrom: 2026-09-30
effectiveTo:
sourceType: internal-implementation
sourceRef: order-service/checkout-and-dashboard; shipping-service/ghn-test; seller-service/onboarding
---

# Phí giao hàng, thu tiền khi nhận hàng và doanh thu của shop

## Tóm tắt

Khi khách đặt hàng, hệ thống hiện hỗ trợ thanh toán khi nhận hàng (COD). Phí giao
hàng được báo theo từng shop và lưu cùng đơn. Trang tổng quan shop hiển thị doanh
thu gộp từ tiền hàng của shop; con số này không phải lợi nhuận, phí giao hàng hay
khoản tiền đã chuyển vào tài khoản của Seller.

Hồ sơ đăng ký shop có thể lưu thông tin tài khoản ngân hàng, nhưng việc lưu thông
tin này không xác nhận hệ thống đã chuyển tiền. Hiện chưa có màn tra cứu khoản
khấu trừ phí nền tảng, bảng đối soát, số tiền thực nhận hoặc ngày tiền về.

## Các khoản phí được tính trong checkout

Khi báo giá hoặc tạo order, Order Service đọc giá sản phẩm đã được Product
Service xác nhận, nhóm sản phẩm theo shop và gửi thông tin địa chỉ, giá trị hàng
và thông số kiện đến Shipping Service. Shipping Service dùng địa chỉ lấy hàng
mặc định của shop cùng địa chỉ giao hàng để yêu cầu quote từ provider đang cấu
hình. Order Service cộng phí của các shop thành `shippingFee` tổng và lưu
`shippingFeeBreakdown` cho từng shop vào order.

Đơn vị vận chuyển hiện được kết nối ở chế độ thử nghiệm và có thể trả về các
khoản sau trong báo giá:

- `baseFee`: phí dịch vụ vận chuyển;
- `declaredValueFee`: phí khai giá theo phản hồi provider;
- `surcharges`: phụ phí provider trả về, có thể gồm COD, lấy/giao vùng xa, giao
  lại hoặc đồng kiểm;
- `fee`: tổng phí quote. Nếu provider không trả tổng, adapter cộng phí dịch vụ,
  phí khai giá và các phụ phí hợp lệ.

Thành phần và số tiền thực tế phụ thuộc dữ liệu quote provider, tuyến giao, địa
chỉ, khối lượng/kích thước kiện, giá trị khai báo và cấu hình provider. Dù
contract quote có trường COD, chỉ sử dụng khoản phụ phí COD nếu provider thực sự
trả khoản đó trong quote; không tự giả định hoặc tự tính mức phí COD. Không có
một mức phí cố định hoặc một tỷ lệ commission có thể suy ra cho mọi đơn. Dùng
`fee` trong quote/order tương ứng; không tự cộng lại các thành phần nếu đã có
tổng `fee`.

Tổng tiền khách cần thanh toán khi đặt hàng được tính như sau:

`Tổng tiền đơn hàng = tổng tiền sản phẩm + phí giao hàng`

`subtotal` là tổng tiền các sản phẩm trong order; `shippingFee` là tổng phí quote
vận chuyển được lưu tại thời điểm đặt hàng. Với order nhiều shop, breakdown cho
biết phần quote gắn với từng shop. Số đã lưu là snapshot của order; quote mới ở
một thời điểm khác không tự sửa lịch sử order cũ.

Đây là phí vận chuyển trong luồng checkout, không phải commission/phí nền tảng
được khấu trừ theo phần trăm doanh thu. Tài liệu này không kết luận seller hay
buyer chịu từng khoản ngoài số tiền và cách hiển thị thực tế của order.

## Thanh toán khi nhận hàng và ghi nhận thu tiền

Hình thức thanh toán hiện có là khách trả tiền khi nhận hàng. Khi người mua xác
nhận đã nhận hàng, hoặc hệ thống tự hoàn tất sau thời hạn chờ xác nhận, đơn được
ghi nhận là đã thu tiền.

Khi tạo vận đơn, số tiền thu hộ cho shop là tiền hàng của các sản phẩm thuộc shop
trong kiện. Phí giao hàng được lưu riêng, vì vậy tiền thu hộ, tiền hàng và phí
giao hàng là các khoản khác nhau.

Việc đơn được ghi nhận là đã thu tiền không chứng minh Seller đã nhận khoản
chuyển vào tài khoản. Không kết luận “tiền đã về shop” chỉ dựa trên trạng thái
đơn hàng.

## Doanh thu hiển thị trên trang tổng quan shop

Doanh thu gộp là tổng tiền hàng của các sản phẩm thuộc shop trong khoảng thời gian
được chọn. Hệ thống tính theo ngày tạo đơn, chỉ tính đơn đã được xác nhận, loại
đơn đã hủy và loại các sản phẩm đang được xử lý trả hàng ở những bước sau:

`AWAITING_SHIPMENT`, `IN_TRANSIT`, `SHIPMENT_FAILED`, `RECEIVED`,
`INSPECTION_FAILED`, `REFUND_PENDING`.

Chỉ giá trị của sản phẩm nằm trong yêu cầu trả hàng tương ứng bị loại; các sản
phẩm khác trong cùng đơn vẫn có thể được tính. Yêu cầu mới gửi, đã bị từ chối
hoặc đã được người mua hủy chưa nằm trong nhóm bước bị loại. Vì vậy doanh thu có
thể thay đổi khi quá trình trả hàng chuyển sang bước tiếp theo.

Con số doanh thu này:

- cộng tiền hàng (`lineTotal`) của item thuộc shop;
- không cộng phí vận chuyển;
- không phải lợi nhuận ròng, tiền COD đã đối soát hoặc payout;
- không tự trừ commission/phí nền tảng vì các khoản này hiện chưa được mô hình
  hóa trong nguồn dashboard đang dùng.

Hệ thống có thể tính doanh thu của đơn đã xác nhận dù giao hàng chưa hoàn tất. Đây
là cách thống kê doanh thu hiện tại, không phải xác nhận Seller đã nhận tiền.
Khoảng thời gian báo cáo dựa trên ngày đặt đơn, không phải ngày chuyển tiền.

## Tài khoản nhận tiền và đối soát

Hồ sơ shop có thể lưu tài khoản nhận tiền và yêu cầu thay đổi thông tin nhạy cảm.
Những thông tin hồ sơ này không phải lịch sử giao dịch, không xác nhận ngân hàng
đã nhận lệnh chuyển tiền và không cho biết shop còn được thanh toán bao nhiêu.

Hiện chưa có dữ liệu tra cứu mức phí nền tảng theo đơn, các khoản khấu trừ, lịch
đối soát, số tiền thực nhận hoặc ngày tiền về. Vì vậy chưa thể tính chính xác
khoản tiền ròng shop sẽ nhận chỉ từ thông tin đơn hàng, trang tổng quan hoặc tài
khoản ngân hàng đã lưu.

Hoàn tiền khi trả hàng là quy trình riêng. Sau khi shop kiểm tra hàng đạt, yêu
cầu chuyển sang bước chờ xử lý hoàn tiền; trạng thái đó không chứng minh tiền đã
được chuyển cho khách. Xem tài liệu đổi trả để biết cách tính khoản hoàn và giới
hạn tra cứu từng yêu cầu.

## Cách BinGPT nên trả lời

- **“Phí bán hàng/đơn hàng được tính sao?”** Hỏi rõ Seller muốn biết phí giao
  hàng, khoản thu hộ khi khách nhận hàng hay phí nền tảng. Giải thích phần đã xác
  nhận và nói rõ nếu chưa có dữ liệu về khoản phí nền tảng.
- **“Phí giao hàng đơn này bao nhiêu?”** Chỉ trả số phí lưu trên đúng đơn nếu có
  thông tin của đơn đó. Không dùng báo giá mới để thay cho khoản đã lưu lúc đặt.
- **“Doanh thu kỳ này là bao nhiêu?”** Dùng số liệu hiện tại của shop, nêu rõ
  khoảng ngày và giải thích đây là tổng tiền hàng, không phải tiền thực nhận.
- **“Đơn đã thu tiền chưa?”** Nêu điều hệ thống ghi nhận cho đơn; không khẳng
  định tiền đã về tài khoản Seller nếu chưa có dữ liệu chuyển tiền/đối soát.
- **“Shop bị trừ phí gì, khi nào nhận được tiền?”** Nói rõ hiện chưa tra cứu
  được các khoản khấu trừ và ngày chuyển tiền; thông tin tài khoản ngân hàng
  trong hồ sơ không thay thế lịch sử thanh toán.
- **“Đơn trả hàng được hoàn bao nhiêu?”** Chỉ trả khoản tiền của đúng yêu cầu
  nếu có thông tin chi tiết; không suy ra từ doanh thu hoặc số yêu cầu đang chờ.

## Nguồn và giới hạn

Các quy tắc được đối chiếu với luồng đặt hàng, giao nhận, thống kê doanh thu và
hồ sơ đăng ký shop trong hệ thống. BinGPT có thể giải thích cách tính phí giao
hàng, ghi nhận tiền thu hộ và doanh thu; hiện chưa tra cứu được phí nền tảng,
bảng đối soát, khoản tiền thực nhận hoặc giao dịch ngân hàng thực tế.
