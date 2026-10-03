---
documentId: seller-center-guide
title: Hướng dẫn vận hành Seller Center và BinGPT
domain: seller-center-troubleshooting
language: vi
version: 2026.09.30
status: published
effectiveFrom: 2026-09-30
effectiveTo:
sourceType: internal-implementation
sourceRef: seller-service, product-service, order-service, shipping-service
---

# Hướng dẫn vận hành Seller Center và BinGPT

## 1. Mục đích và phạm vi

Tài liệu này giúp Seller hiểu các nhóm chức năng đang có trong Seller Center và
giúp BinGPT chọn đúng nguồn khi trả lời câu hỏi. Các hướng dẫn mô tả hành vi
hiện tại của hệ thống; chúng không tự tạo thêm cam kết về thời gian xử lý, phí,
điều kiện pháp lý hoặc kết quả của một giao dịch cụ thể.

Seller Center có các nhóm nghiệp vụ chính:

- tổng quan hoạt động shop;
- quản lý sản phẩm, biến thể và tồn kho;
- xem và xử lý đơn hàng;
- theo dõi vận đơn;
- xử lý yêu cầu đổi trả;
- quản lý hồ sơ shop;
- cấu hình giao nhận và địa chỉ lấy hàng.

BinGPT hỗ trợ đọc số liệu tổng quan, giải thích tài liệu đã xác minh và hướng dẫn
theo nguồn hiện có. BinGPT không thay Seller thực hiện các thao tác nghiệp vụ.

## 2. Nguyên tắc dữ liệu và quyền truy cập

Mỗi service sở hữu dữ liệu của nghiệp vụ mình. Seller Service tổng hợp một số
read model cho dashboard và cung cấp hồ sơ/cấu hình shop; Product, Order và
Shipping Service quản lý dữ liệu tương ứng của sản phẩm, đơn hàng và vận đơn.

Phạm vi shop được backend suy ra từ tài khoản Seller đã xác thực. Các API Seller
không dùng `shopId` do trình duyệt hoặc câu hỏi AI tự chọn để đổi sang shop khác.
BinGPT chỉ được trả dữ liệu của shop hiện tại trong phiên làm việc.

Khi đọc dữ liệu, cần phân biệt rõ:

- **Có giá trị 0**: nguồn đã đọc thành công và số liệu thực sự bằng 0.
- **Chưa có dữ liệu**: nguồn không cung cấp giá trị tương ứng.
- **Nguồn lỗi hoặc không truy cập được**: không được biến lỗi thành số 0 hay kết
  luận rằng shop không có dữ liệu.
- **Policy/evidence**: chỉ dùng tài liệu `published`, đúng domain, phiên bản và
  thời gian hiệu lực; nội dung tài liệu là nguồn giải thích, không phải dữ liệu
  live của riêng shop.

## 3. Tổng quan shop và dashboard

Seller Dashboard chỉ cho phép chọn một trong ba khoảng thời gian: **7 ngày, 30
ngày hoặc 90 ngày**. Mặc định là 30 ngày. Kỳ so sánh trước đó có cùng độ dài;
ngày được tính theo múi giờ nghiệp vụ `Asia/Ho_Chi_Minh`.

Dashboard ghép dữ liệu Order Service và Product Service cho shop đang hoạt động.
Các chỉ số hiện có gồm:

| Nhóm      | Chỉ số hiển thị                                                             | Ý nghĩa và giới hạn                                                                                                   |
| --------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Doanh thu | `grossRevenue` và kỳ trước                                                  | Tổng tiền hàng của item thuộc shop theo quy tắc Order Service; không đồng nghĩa với lợi nhuận hay tiền Seller đã nhận |
| Đơn hàng  | Số đơn kỳ này/kỳ trước và xu hướng theo ngày                                | Số đơn được tính trong khoảng thời gian đã chọn                                                                       |
| Hàng đợi  | Chờ xác nhận, chờ giao, đang giao, đã giao, hoàn tất, đã hủy, return/refund | Số tổng hợp trạng thái hiện tại; không thay cho chi tiết và lịch sử đầy đủ từng đơn                                   |
| Sản phẩm  | Đang hoạt động, hết hàng và tối đa 5 sản phẩm nổi bật                       | Ảnh chụp tổng hợp; danh sách sản phẩm đầy đủ nằm trong chức năng quản lý sản phẩm                                     |
| Return    | Số yêu cầu cần theo dõi                                                     | Số lượng tổng hợp, không cho biết riêng số tiền hoặc kết quả của từng yêu cầu                                         |

Dashboard hiện trả tối đa 5 đơn gần nhất và tối đa 5 sản phẩm nổi bật. Nếu Seller
hỏi về đơn hoặc sản phẩm cụ thể nhưng snapshot không có detail đó, BinGPT cần nói
rõ giới hạn của snapshot; không lấy một dòng gần nhất thay cho đối tượng đang hỏi.

Doanh thu dashboard là doanh thu gộp theo tiền hàng. Không diễn giải thành lãi
ròng, commission, payout hay số tiền đã thu COD. Khi kỳ trước bằng 0, phần trăm
thay đổi không có ý nghĩa để tính; hãy nêu số tuyệt đối và nói ngắn gọn vì sao
chưa thể so sánh theo phần trăm.

## 4. Quản lý sản phẩm và tồn kho

Seller Center cho phép Seller:

- xem danh sách và chi tiết sản phẩm thuộc shop;
- lọc theo trạng thái, tìm theo tên, slug hoặc SKU và phân trang;
- tạo sản phẩm nháp hoặc sản phẩm hoạt động;
- cập nhật nội dung sản phẩm, hình ảnh, thuộc tính, biến thể, giá và thông tin
  đóng gói;
- bật hoặc tắt sản phẩm;
- xóa mềm sản phẩm và khôi phục sản phẩm đã xóa theo quyền được cấp.

Một sản phẩm có thể có nhiều biến thể. Tồn kho được quản lý ở cấp biến thể; số
tổng tồn sản phẩm được tổng hợp từ các biến thể. Hệ thống giữ riêng lượng có
sẵn và lượng đã reserve cho đơn checkout. Vì vậy, số lượng đang được giữ cho đơn
không nên bị hiểu là hàng đã bán hoặc hàng có thể tiếp tục bán.

Các yêu cầu tạo và cập nhật sản phẩm được backend kiểm tra category, dữ liệu biến
thể, SKU, hình ảnh và thông tin đóng gói. Sản phẩm chỉ được bật khi qua các kiểm
tra nghiệp vụ áp dụng cho trạng thái đó. Nếu API trả lỗi validation, Seller cần
sửa đúng trường được báo; BinGPT không được đoán rằng sản phẩm đã được đăng thành
công khi chưa có kết quả từ hệ thống.

BinGPT trong luồng hỏi đáp hiện dùng số sản phẩm, trạng thái tồn và tối đa 5 sản
phẩm dashboard cung cấp. Muốn sửa tên, giá, biến thể, tồn kho hoặc trạng thái sản
phẩm, Seller thực hiện trong màn hình quản lý sản phẩm.

## 5. Xem và xử lý đơn hàng

Order Service cung cấp danh sách phân trang và detail đơn cho Seller. Kết quả chỉ
gồm order có item thuộc shop hiện tại; order nhiều shop không làm lộ item của
shop khác.

Seller có thể lọc danh sách theo trạng thái, giai đoạn fulfillment hoặc mã đơn,
sau đó mở detail để xem phần thuộc shop mình. Order có hai trục trạng thái cần
đọc riêng:

- trạng thái order, ví dụ `PENDING`, `CONFIRMED`, `FAILED`, `CANCELLED`;
- trạng thái fulfillment, ví dụ `TO_SHIP`, `SHIPPING`, `DELIVERED`,
  `COMPLETED`, `DELIVERY_FAILED`, `RETURN_REFUND`.

`CONFIRMED` không có nghĩa là đã giao xong. `DELIVERED` cũng không tự chứng minh
COD đã được đánh dấu thu. Hãy đọc đúng trạng thái được hỏi và dùng detail live
khi câu hỏi nhắc một đơn cụ thể.

BinGPT dashboard chỉ có bộ đếm và tối đa 5 đơn gần nhất. BinGPT không có trong
luồng này quyền tự duyệt, hủy, sửa đơn hoặc tự chọn một đơn để thao tác. Câu hỏi
“đơn nào cần xử lý trước” chỉ được trả lời nếu nguồn đang có danh sách detail và
quy tắc ưu tiên phù hợp; số đếm tổng hợp không đủ để xếp hạng.

## 6. Vận đơn và giao nhận

Seller có thể tạo, xem, làm mới trạng thái, hủy vận đơn khi còn đủ điều kiện và
tải nhãn vận chuyển. Việc tạo vận đơn yêu cầu order đã xác nhận, item thuộc shop,
thông tin kiện hàng hợp lệ và địa chỉ lấy hàng mặc định. Trạng thái vận đơn được
đồng bộ từ Shipping Service/provider; thao tác làm mới truy vấn trạng thái hiện
có, không tự đẩy vận đơn sang bước tiếp theo.

Địa chỉ lấy hàng, bật/tắt giao hàng, thời gian chuẩn bị và khung giờ lấy hàng
được quản lý trong phần cài đặt giao nhận. Câu hỏi về giá trị hiện tại của shop
phải đọc live settings hoặc readiness. Các giá trị khởi tạo trong tài liệu không
phải cấu hình hiện tại của mọi shop.

Các chi tiết về readiness, quote, trạng thái shipment và luồng vận đơn hoàn được
mô tả trong tài liệu [Vận hành giao nhận và quản lý địa chỉ lấy hàng]. BinGPT
không được suy ra ETA hoặc SLA từ trạng thái hiện tại nếu nguồn không trả dữ liệu
thời gian tương ứng.

## 7. Đổi trả và hoàn tiền

Seller có thể xem hàng đợi return thuộc shop, duyệt hoặc từ chối yêu cầu và ghi
nhận kết quả kiểm tra kiện hàng sau khi nhận lại. Return request là workflow
riêng, không đồng nhất với fulfillment status của order hoặc trạng thái vận đơn.

Hệ thống hiện lưu snapshot tiền hàng được chọn, phần phí vận chuyển được hoàn,
phí vận chuyển chiều ngược và tổng tiền refund cho từng yêu cầu. Các giá trị đó
phụ thuộc order, item, lý do và quote thực tế. Số `pendingReturns` trên dashboard
chỉ là số lượng; không thể dùng nó để suy ra số tiền hoàn.

Các bước, điều kiện và công thức snapshot được mô tả chi tiết trong tài liệu
[Quy trình đổi trả và hoàn tiền hiện tại]. Khi Seller hỏi về một request cụ thể,
cần có return detail tương ứng. Trạng thái `REFUND_PENDING` nghĩa là workflow
đang chờ bước hoàn tiền; không tự khẳng định tiền đã vào tài khoản.

## 8. Hồ sơ shop và thay đổi thông tin

Hồ sơ shop hiển thị thông tin công khai, trạng thái shop và một số thông tin thuế,
thanh toán, định danh đã được che dữ liệu nhạy cảm. Seller có thể cập nhật các
trường hồ sơ công khai được API cho phép như tên, mô tả, logo và thông tin liên
hệ.

Thay đổi thông tin thuế, tài khoản nhận tiền hoặc định danh được gửi thành yêu
cầu thay đổi để admin xem xét. Khi có yêu cầu đang chờ, khả năng tạo yêu cầu mới
có thể bị giới hạn. BinGPT chỉ nên giải thích trạng thái hiển thị và chỉ dẫn mở
đúng phần hồ sơ; không đọc, lặp lại hoặc tự suy diễn dữ liệu nhạy cảm đã bị che.

## 9. Chọn đúng nguồn khi hỏi BinGPT

| Dạng câu hỏi                                                 | Nguồn cần dùng                                                                                | Cách trả lời phù hợp                                                              |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Doanh thu, số đơn, sản phẩm nổi bật, tồn hết hàng            | Dashboard live                                                                                | Nêu số liệu, khoảng thời gian và giới hạn của snapshot                            |
| Số liệu của một đơn/sản phẩm cụ thể                          | Detail API nếu đã được tích hợp vào luồng hỏi đáp; nếu không, nói rõ snapshot không có detail | Không dùng số tổng hợp để đoán detail                                             |
| Trạng thái readiness hoặc giá trị cài đặt giao nhận hiện tại | Seller Service live settings/readiness                                                        | Trả giá trị live và hướng dẫn thao tác tương ứng                                  |
| Cách tính phí hoặc quy trình hoàn hàng nói chung             | Tài liệu knowledge đã publish                                                                 | Giải thích quy tắc trong tài liệu; tách phần hệ thống có dữ liệu với phần chưa có |
| Câu hỏi kết hợp số liệu shop và quy trình                    | Dashboard cùng policy evidence                                                                | Trả riêng từng ý, không dùng policy để thay số liệu live                          |
| Đại từ như “nó”, “đơn đó”, “sản phẩm kia”                    | Ngữ cảnh hội thoại và thực thể đã resolve                                                     | Tiếp tục nếu có một đối tượng rõ; nếu không, hỏi lại ngắn gọn                     |

Qdrant chỉ cung cấp tài liệu knowledge đã được publish, còn dashboard và cấu hình
shop đến từ nguồn live. Citation cần khớp với tài liệu/section thực sự truy xuất
được; không trích một tài liệu chỉ vì tiêu đề có từ khóa giống câu hỏi.

## 10. Cách trình bày câu trả lời

BinGPT nên bắt đầu bằng câu trả lời trực tiếp vào điều Seller hỏi. Với câu hỏi
đơn giản, thường một đoạn ngắn là đủ. Với câu hỏi nhiều phần, tách từng phần
theo đúng thứ tự người dùng hỏi. Chỉ dùng danh sách hoặc bảng khi có nhiều bước,
trạng thái hoặc số liệu cần so sánh.

Khi có dữ liệu, nói rõ đó là số liệu hiện tại hay quy tắc trong tài liệu. Nếu chỉ
có một phần evidence, trả phần đã xác minh trước rồi nêu cụ thể phần còn thiếu.
Không lặp lại cùng một cảnh báo dưới nhiều đoạn và không dùng câu “chưa có dữ
liệu” chung chung nếu nguồn đã cung cấp câu trả lời cho một phần câu hỏi.

Ví dụ, với câu hỏi “Shop có bao nhiêu đơn chờ giao và cần làm gì?”, hãy nêu số
đơn từ dashboard trước, sau đó hướng dẫn bước xử lý có trong tài liệu. Nếu không
có danh sách detail hoặc deadline, nói rõ chưa thể xác định đơn nào cần ưu tiên
hoặc hạn xử lý cụ thể.

## 11. Những thao tác BinGPT không tự thực hiện

BinGPT không tự tạo, cập nhật, bật/tắt hoặc xóa sản phẩm; không thay đổi tồn kho;
không duyệt, hủy hay sửa đơn; không tạo hoặc hủy vận đơn; không thay địa chỉ lấy
hàng/cấu hình giao nhận; không duyệt thay đổi hồ sơ shop; và không phát hành bản
nháp AI thành nội dung chính thức. Các thao tác này cần được Seller thực hiện
trong chức năng nghiệp vụ tương ứng.
