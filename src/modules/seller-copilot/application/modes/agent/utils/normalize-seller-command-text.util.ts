// Chuẩn hóa câu lệnh tiếng Việt cho bộ nhận diện deterministic của Agent.
// Chỉ bỏ dấu Latin sau NFC để mỗi chữ tiếng Việt vẫn chiếm một code unit như câu gốc khi parser cắt chuỗi.

// Hạ chữ và bỏ dấu tiếng Việt; không NFD toàn chuỗi vì một số hệ chữ có thể nở thành nhiều code unit làm lệch vị trí số.
export function normalizeSellerCommandText(value: string): string {
    return value
        .normalize('NFC')
        .replace(/[À-ỹĐđ]/gu, (letter) => {
            const folded =
                letter === 'Đ' || letter === 'đ'
                    ? 'd'
                    : letter.normalize('NFD').replace(/\p{M}/gu, '');
            return folded.length === letter.length
                ? folded.toLocaleLowerCase('vi')
                : letter.toLocaleLowerCase('vi');
        })
        .replace(/[A-Z]/gu, (letter) => letter.toLowerCase())
        .replace(/[Đđ]/gu, 'd');
}
