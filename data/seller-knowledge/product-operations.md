---
documentId: product-operations
title: Quản lý sản phẩm, tồn kho và dữ liệu BinGPT có thể tra cứu
domain: product-content
language: vi
version: 2026.09.30
status: published
effectiveFrom: 2026-09-30
effectiveTo:
sourceType: internal-implementation
sourceRef: product-service/catalog-and-inventory; seller-service/dashboard-and-copilot
---

# Quản lý sản phẩm, tồn kho và dữ liệu BinGPT có thể tra cứu

## Phạm vi và cách hiểu

Tài liệu này tổng hợp hành vi catalog/tồn kho hiện có trong Product Service và
phạm vi dữ liệu sản phẩm mà Seller Dashboard, BinGPT đang đọc được. Các gợi ý
viết nội dung ở cuối là khuyến nghị thực hành, không phải điều kiện validation
bắt buộc hay chính sách kiểm duyệt chính thức.

## Tạo và vận hành sản phẩm

Khi tạo sản phẩm, hệ thống kiểm tra cấu trúc dữ liệu theo ngành hàng: ngành hàng
phải đang hoạt động và là ngành hàng cấp cuối; thuộc tính phải theo schema của
catalog; ảnh, video, nhóm phân loại, tổ hợp biến thể và mã thương mại phải đúng
các validation tương ứng. Các kiểm tra này bảo đảm dữ liệu catalog hợp lệ, không
thay thế quy trình duyệt hàng hóa hoặc kiểm tra tuân thủ. Xem thêm
`restricted-products-policy.md` nếu seller hỏi hàng cấm, hạn chế hoặc lý do sản
phẩm bị từ chối.

Trạng thái sản phẩm trong catalog:

- `DRAFT`: bản nháp;
- `ACTIVE`: đang hoạt động/đăng bán;
- `INACTIVE`: đã ngừng bán;
- `DELETED`: đã xóa mềm.

Seller có thể bật hoặc tắt trạng thái đăng bán đối với sản phẩm thuộc shop của
mình. Trước khi bật `ACTIVE`, hệ thống kiểm tra shop đã cấu hình sẵn sàng giao
nhận. Đây là điều kiện vận hành, không phải phê duyệt nội dung. Sản phẩm nháp
không thể chuyển thẳng sang `INACTIVE`; cần hoàn thiện và đăng bán trước. Sản
phẩm đang `ACTIVE` phải được ngừng bán trước khi xóa; sản phẩm đã có giao dịch
bán không được xóa để giữ lịch sử. Sản phẩm xóa mềm có thể được khôi phục về
`INACTIVE`, không tự đăng bán lại.

## Tồn kho theo biến thể

Tồn kho được quản lý ở cấp biến thể. Khi chỉnh sửa sản phẩm, số lượng seller
nhập là tồn khả dụng; phần đã giữ cho đơn (`quantityReserved`) được giữ riêng.
Trong dữ liệu, `stockQuantity` của biến thể lưu tổng vật lý gồm lượng khả dụng
và lượng đang giữ chỗ. Vì vậy không cộng lượng giữ chỗ vào tồn có thể bán lần
nữa.

Khi checkout giữ hàng, số lượng khả dụng giảm và số lượng giữ chỗ tăng. Nếu đơn
bị hủy theo luồng tương ứng, phần giữ chỗ được giải phóng trở lại khả dụng. Khi
cập nhật tồn kho thủ công, seller nên đối chiếu số hàng thực tế và nhập đúng số
có thể bán; không nhập lại phần đã được giữ cho các đơn chưa hoàn tất.

BinGPT không điều chỉnh tồn kho. Nếu cần nhập hàng, seller cập nhật tồn ở màn
hình quản lý sản phẩm theo từng biến thể rồi yêu cầu BinGPT đọc lại số liệu mới.

## Dashboard hiện cung cấp dữ liệu gì

Seller Dashboard lấy KPI sản phẩm từ Product Service và dữ liệu bán hàng từ
Order Service. Các trường sản phẩm hiện có gồm:

- `activeProducts`: số sản phẩm đang `ACTIVE`;
- `outOfStockProducts`: số sản phẩm đang `ACTIVE` mà không còn biến thể đang
  hoạt động có tồn khả dụng lớn hơn 0;
- danh sách tối đa 5 sản phẩm, kèm tên, `productId`, ảnh đại diện nếu có, số
  lượng bán, doanh thu nếu nguồn cung cấp và tồn khả dụng nếu ghép được dữ liệu.

`outOfStockProducts` chỉ là một con số tổng hợp, không phải danh sách tên các
sản phẩm hết hàng. `activeProducts` cũng không cho biết số biến thể, tồn từng
biến thể hay trạng thái kiểm duyệt.

Danh sách sản phẩm tối đa 5 mục không phải toàn bộ catalog. Seller Copilot hiện
dựa vào dashboard snapshot này; nó không truy vấn tùy ý toàn bộ catalog, không
đọc đầy đủ mô tả/SKU/giá vốn/biến thể của một sản phẩm bất kỳ và không thực hiện
thao tác tạo, sửa, xóa hoặc đổi tồn kho.

## Cách hiểu số liệu bán sản phẩm

Order Service cung cấp các sản phẩm có phát sinh bán trong khoảng thời gian
dashboard đang chọn (7, 30 hoặc 90 ngày), cùng số lượng bán và doanh thu trong
kỳ. Product Service cung cấp thêm tối đa 5 sản phẩm `ACTIVE`, xếp theo tổng số
lượng bán tích lũy (`total_sold`). Seller Dashboard ghép danh sách theo
`productId`: đưa danh sách của Order Service lên trước, rồi dùng danh sách tích
lũy để bổ sung cho đủ tối đa 5 mục; sản phẩm trùng được giữ một lần.

Do đó, các mục đầu có dữ liệu Order Service phản ánh kỳ đã chọn; các mục được
bổ sung từ Product Service có thể dựa trên doanh số tích lũy chứ không chỉ riêng
kỳ đó, và doanh thu của chúng có thể chưa có (`null`). Dashboard không gắn nhãn
nguồn xếp hạng lên từng mục, vì vậy BinGPT không được khẳng định cả danh sách là
“top bán chạy trong 30 ngày” nếu không xác minh từng mục có dữ liệu bán trong
kỳ. Khi doanh thu hoặc tồn kho là `null`, phải nói là chưa có dữ liệu, không đổi
thành 0.

## Cảnh báo tồn thấp trong BinGPT

Insight tồn thấp của BinGPT chỉ xét danh sách top sản phẩm tối đa 5 mục nêu trên
và đánh dấu mục có tồn khả dụng được báo về `<= 5`. Đây là ngưỡng hiển thị hiện
đang dùng trong Copilot, không phải danh sách toàn bộ biến thể sắp hết hàng và
không nên giới thiệu như ngưỡng cảnh báo cấu hình riêng của seller. KPI sản phẩm
hết hàng là con số tổng; nó không giúp BinGPT nêu tên mặt hàng nếu snapshot không
có tên sản phẩm tương ứng.

Vì vậy, BinGPT có thể tóm tắt rủi ro trong dữ liệu đang thấy và khuyên seller
kiểm tra tồn theo biến thể. Không kết luận cần nhập bao nhiêu hàng hoặc ngày nào
sẽ hết hàng nếu không có tốc độ bán, thời gian nhập hàng và dữ liệu tồn phù hợp.

## Hướng dẫn viết nội dung — khuyến nghị, không phải chính sách bắt buộc

Để người mua dễ hiểu, seller có thể đặt tên ngắn gọn, nêu loại sản phẩm và thuộc
tính phân biệt; mô tả có thể trình bày công dụng, thông số, cách sử dụng và lưu
ý quan trọng. Nên dùng thông tin có thể kiểm chứng, tránh cam kết quá mức hoặc
thông tin mâu thuẫn giữa tiêu đề, mô tả, ảnh và biến thể.

Đây là gợi ý chất lượng nội dung, không phải quy tắc pháp lý, danh sách từ cấm
hay cam kết rằng sản phẩm sẽ được duyệt. Nếu được yêu cầu viết nội dung, BinGPT
có thể tạo bản nháp dựa trên thông tin seller cung cấp; seller cần kiểm tra độ
chính xác trước khi đăng. Không tự bịa chất liệu, chứng nhận, công dụng, xuất xứ,
bảo hành hay thuộc tính sản phẩm còn thiếu.

## Quy tắc trả lời của BinGPT

- Với câu hỏi số liệu của shop, chỉ dùng dashboard snapshot; nói rõ kỳ thời gian
  khi câu hỏi liên quan số lượng bán hoặc doanh thu.
- Với câu hỏi “sản phẩm nào hết hàng?”, nêu số tổng nếu chỉ có KPI; chỉ nêu tên
  sản phẩm khi có mục cụ thể trong evidence. Không biến `outOfStockProducts`
  thành danh sách.
- Với câu hỏi sản phẩm cụ thể, trước tiên đối chiếu tên với sản phẩm trong
  snapshot hiện tại và ngữ cảnh hội thoại. Nếu không thấy sản phẩm đó trong danh
  sách giới hạn, nói rõ Copilot chưa có dữ liệu chi tiết để tra thay vì lấy sản
  phẩm đầu danh sách thay thế.
- Không gọi sản phẩm có tồn bằng 0 là `INACTIVE`; trạng thái đăng bán và tồn
  kho là hai thông tin khác nhau.
- Không suy ra lợi nhuận, giá vốn, dự báo hết hàng, biến thể/SKU hoặc nguyên nhân
  bị từ chối khi snapshot không có các trường đó.
- Tách gợi ý tối ưu nội dung khỏi quy định bắt buộc; câu hỏi về hàng cấm, giấy
  phép hoặc kiểm duyệt cần theo `restricted-products-policy.md` và nguồn chính
  thức nếu có.
