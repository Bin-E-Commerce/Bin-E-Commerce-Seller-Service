---
documentId: restricted-products-policy
title: Giới hạn dữ liệu về sản phẩm cấm và sản phẩm hạn chế
domain: restricted-products
language: vi
version: 2026.09.30
status: published
effectiveFrom: 2026-09-30
effectiveTo:
sourceType: internal-implementation
sourceRef: product-service/seller-products-and-catalog
---

# Giới hạn dữ liệu về sản phẩm cấm và sản phẩm hạn chế

## Kết luận hiện tại

Trong các nguồn nghiệp vụ hiện có của dự án, chưa có danh mục sản phẩm bị cấm
hoặc hạn chế, tiêu chí xác định theo ngành hàng, quy trình thẩm định/phê duyệt,
hay trạng thái tuân thủ gắn với từng sản phẩm. Vì vậy BinGPT hiện không thể xác
nhận một mặt hàng cụ thể có được phép bán trên nền tảng hay không, cần giấy phép
nào, hoặc vì sao mặt hàng bị từ chối.

Đây là giới hạn của dữ liệu và chức năng trong hệ thống hiện tại; không có nghĩa
là nền tảng không có quy định, hoặc một sản phẩm được phép bán theo pháp luật.
Khi cần kết luận tuân thủ, seller cần đối chiếu quy định chính thức của nền tảng
và quy định áp dụng cho mặt hàng đó.

## Product Service hiện kiểm tra những gì

Luồng tạo sản phẩm kiểm tra tính hợp lệ của dữ liệu catalog và cấu trúc sản
phẩm. Ví dụ, ngành hàng được chọn phải đang hoạt động và là ngành hàng cấp cuối;
các thuộc tính phải phù hợp schema của ngành hàng; ảnh, video, phân loại, biến
thể và mã thương mại phải đáp ứng validation tương ứng.

Các kiểm tra này nhằm bảo đảm dữ liệu sản phẩm đúng cấu trúc để vận hành catalog.
Chúng không phải bước rà soát hàng cấm, xác minh giấy phép hay duyệt nội dung
theo chính sách ngành hàng. Chọn được một ngành hàng đang hoạt động cũng không
đồng nghĩa mọi sản phẩm thuộc ngành hàng đó mặc nhiên được phép kinh doanh.

Trạng thái catalog của sản phẩm gồm:

- `DRAFT`: bản nháp;
- `ACTIVE`: đang hoạt động/đăng bán trong catalog;
- `INACTIVE`: đã ngừng bán;
- `DELETED`: đã xóa mềm.

Seller Product Service cho phép seller bật/tắt trạng thái đăng bán cho sản phẩm
thuộc quyền sở hữu của mình; trước khi bật `ACTIVE`, hệ thống kiểm tra shop đã
sẵn sàng về cấu hình giao nhận. Đây là kiểm tra điều kiện vận hành shop, không
phải kết quả thẩm định nội dung hoặc chứng nhận tuân thủ. `ACTIVE` không xác
nhận rằng sản phẩm đã qua kiểm duyệt pháp lý; `INACTIVE` hay `DELETED` cũng
không cung cấp nguyên nhân liên quan đến chính sách hàng hóa.

## Cách BinGPT cần trả lời

### Khi seller hỏi một sản phẩm cụ thể có được phép bán không

Không phân loại sản phẩm là được phép hay bị cấm chỉ dựa vào tên, mô tả, ảnh,
ngành hàng, trạng thái catalog hoặc kiến thức tổng quát của mô hình. Trả lời rõ
rằng dữ liệu hiện có chưa có danh mục/quy trình thẩm định để xác nhận mặt hàng
này; hướng seller đến chính sách chính thức của nền tảng hoặc bộ phận phụ trách
tuân thủ.

### Khi seller hỏi danh sách sản phẩm cấm/hạn chế hoặc giấy phép cần có

Không tự tạo danh sách, điều kiện pháp lý, giấy phép, thời hạn duyệt, mức phạt
hay hướng dẫn “lách” kiểm duyệt. Nêu rằng Seller Copilot hiện chưa có nguồn chính
thức và có phiên bản để trả lời chính xác; đề nghị seller kiểm tra quy định đang
hiệu lực từ nền tảng và cơ quan có thẩm quyền.

### Khi seller hỏi vì sao sản phẩm bị từ chối hoặc không hiển thị

Không gán nguyên nhân là vi phạm chính sách nếu không có quyết định duyệt/từ
chối hoặc mã lý do từ một nguồn live. Có thể giải thích rằng trạng thái catalog
cho biết vòng đời đăng bán, nhưng không chứa đủ căn cứ để kết luận nguyên nhân
kiểm duyệt. Nếu seller cung cấp thông báo hoặc mã lỗi cụ thể, chỉ giải thích
trong phạm vi nội dung đó và không suy rộng thành chính sách chung.

### Câu trả lời mẫu

“Hiện dữ liệu BinGPT được kết nối chưa có danh mục hàng cấm/hạn chế hoặc trạng
thái thẩm định cho từng sản phẩm, nên mình chưa thể xác nhận mặt hàng này có được
phép bán hay cần giấy tờ gì. Trạng thái ‘đang bán’ trong catalog chỉ phản ánh
trạng thái vận hành, không phải xác nhận đã qua kiểm tra tuân thủ. Bạn hãy đối
chiếu chính sách chính thức đang áp dụng cho ngành hàng này trước khi đăng bán.”

## Điều kiện để mở rộng khả năng trả lời

Muốn BinGPT trả lời có căn cứ hơn, hệ thống cần có nguồn do owner nghiệp vụ xác
nhận, tối thiểu gồm:

- danh mục sản phẩm/ngành hàng bị cấm hoặc hạn chế, phạm vi áp dụng và ví dụ;
- yêu cầu hồ sơ/giấy phép nếu có, nguồn ban hành và ngày hiệu lực;
- quy trình gửi duyệt, các trạng thái và thời hạn nếu được quy định;
- mã lý do từ chối cùng hướng xử lý được phép;
- API hoặc read model tra cứu kết quả thẩm định theo shop và sản phẩm;
- phiên bản hóa, ngày cập nhật và đầu mối chịu trách nhiệm duy trì nội dung.

Cho đến khi các nguồn trên được xác nhận và kết nối, tài liệu này chỉ xác lập
giới hạn trả lời an toàn; nó không phải danh mục hay chính sách hàng hóa của nền
tảng.
