# LendingPro – Tra cứu khoản vay

Web app tĩnh (HTML/CSS/JS, không cần build) tra cứu khoản vay từ file sao kê **LD23 – Sao kê tín dụng** (.xlsx).
Chạy tốt trên máy tính lẫn điện thoại, tự đổi sáng/tối theo thiết bị.

## Cách dùng
1. Mở app (GitHub Pages hoặc `npm start` rồi vào http://localhost:8000).
2. Kéo thả / chọn file `.xlsx`. File được đọc **ngay trên trình duyệt**, không gửi đi đâu; dữ liệu đã đọc được nhớ trong trình duyệt (IndexedDB) cho lần sau. Bấm **Nạp file** để thay file mới.
3. Gõ họ tên (có dấu hay không đều được), ID khách hàng hoặc mã hợp đồng. Phím `/` để focus ô tìm kiếm.

## Lưu và đồng bộ dữ liệu trên GitHub
- App tự tải `data/loans.json` (qua GitHub API, luôn là bản mới nhất) mỗi lần mở, nên mọi thiết bị đều thấy cùng dữ liệu.
- Để **cập nhật dữ liệu từ bất kỳ thiết bị nào**: bấm ⚙ nhập *Personal Access Token* (fine-grained, repo này, quyền *Contents: Read and write*; chỉ lưu trong trình duyệt thiết bị đó), rồi bấm **Nạp file** chọn file LD23 mới – app đọc file và tự commit `data/loans.json` lên GitHub.
- Không có token thì vẫn nạp và tra cứu được trên thiết bị đó, nhưng không cập nhật lên GitHub.

> ⚠️ **Hiện repo đang công khai nên dữ liệu khách hàng trong `data/loans.json` ai cũng xem được** (kể cả lịch sử commit). Đây chỉ là giai đoạn test; cần chuyển sang phương án bảo mật trước khi dùng thật. File Excel gốc vẫn bị chặn trong `.gitignore`.

## Cột dữ liệu sử dụng
| Hiển thị | Cột |
|---|---|
| ID khách hàng / Họ tên | D / E |
| Mã HĐ chính | B |
| Ngày vay / Ngày kết thúc | G / H |
| Số tiền vay / Gốc còn lại | O / R |
| Lãi suất (%/năm) | I |
| Kỳ hạn (tháng) / Tên kỳ hạn | M / N |
| Sản phẩm | AF |
| Mã Port / Tên Port | AT / AU |
| Sale ID / Tên cán bộ bán | BG / BH |

Cột được nhận theo **tên tiêu đề** (dòng chứa "Hợp đồng chính"), nên vẫn chạy nếu file thêm/bớt cột phía trước.

## Cách tính số tiền phải trả
- **Ngắn hạn** (`NGANHAN`): mỗi tháng chỉ trả lãi = dư nợ × lãi suất ÷ 12; gốc trả một lần ở kỳ cuối (ngày đáo hạn).
- **Trung / dài hạn** (`TRUNGHAN`, `DAIHAN`): trả gốc + lãi hàng tháng theo dư nợ giảm dần: gốc mỗi kỳ = số tiền vay ÷ số kỳ, lãi = dư nợ còn lại × lãi suất ÷ 12. Có thêm tuỳ chọn *niên kim* (tổng trả đều mỗi kỳ).
- **Kỳ tới** được ước tính theo *Gốc còn lại* hiện tại và ngày báo cáo trong file; **lịch trả nợ** đầy đủ tính trên số tiền vay ban đầu.
- Số kỳ = cột Kì hạn (tháng). Nếu trống/0 (thấu chi, thẻ…) thì suy ra từ ngày mở – ngày đáo hạn (có ghi chú); nếu không có ngày thì không tính lịch.
- Một hợp đồng chính có thể kèm dòng phụ (phân hệ PD…): hiển thị ở mục *Khoản liên quan*, không cộng vào Gốc còn lại của hợp đồng chính.

Kết quả mang tính tham khảo, không thay thế sao kê chính thức (lãi thực tế phụ thuộc số ngày, lãi suất thả nổi, phí).

## Phát triển
```bash
npm test     # kiểm thử phần tính toán
npm start    # chạy thử cục bộ
```
Thư viện đọc Excel: [SheetJS](https://sheetjs.com) 0.18.5 (Apache-2.0), đặt sẵn trong `vendor/`.

## Bật GitHub Pages
Settings → Pages → Deploy from branch → `main` / root.
