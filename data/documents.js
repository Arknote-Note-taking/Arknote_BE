const documents = [
  {
    title: 'Quy chế lương thưởng 2024',
    content: 'Nội dung quy định chi tiết về lương thưởng, phụ cấp, OT và các chính sách thăng tiến.',
    summary: 'Quy chế quy định chi tiết về chế độ lương, thưởng, phụ cấp cho nhân viên toàn công ty áp dụng từ Q1/2024.',
    tags: ['lương', 'thưởng', 'quy chế'],
    subject: 'Nhân sự',
    fileUrl: '/uploads/mock_luong_thuong.pdf',
    aiConfidence: 95
  },
  {
    title: 'Hợp đồng lao động mẫu',
    content: 'Mẫu hợp đồng lao động thời hạn 1 năm cho nhân sự mới.',
    summary: 'Mẫu hợp đồng lao động chuẩn áp dụng cho nhân viên mới, bao gồm các điều khoản cơ bản và bảo mật.',
    tags: ['hợp đồng', 'lao động', 'mẫu'],
    subject: 'Nhân sự',
    fileUrl: '/uploads/mock_hop_dong.pdf',
    aiConfidence: 92
  },
  {
    title: 'Quy trình mua sắm thiết bị',
    content: 'Quy trình đề xuất mua sắm laptop, bàn ghế, thiết bị và ngân sách phòng ban.',
    summary: 'Quy trình chuẩn để đề xuất, phê duyệt và mua sắm thiết bị văn phòng và công nghệ.',
    tags: ['mua sắm', 'thiết bị', 'quy trình'],
    subject: 'Hành chính',
    fileUrl: '/uploads/mock_mua_sam.pdf',
    aiConfidence: 88
  },
  {
    title: 'Chính sách bảo mật thông tin',
    content: 'Quy định về truy cập mạng nội bộ, quyền chia sẻ file.',
    summary: 'Chính sách bảo mật thông tin nội bộ, quy định về truy cập dữ liệu, mật khẩu và xử lý vi phạm.',
    tags: ['bảo mật', 'CNTT', 'chính sách'],
    subject: 'Hành chính',
    fileUrl: '/uploads/mock_bao_mat.pdf',
    aiConfidence: 91
  },
  {
    title: 'Nghị định 145/2020/NĐ-CP',
    content: 'Nghị định quy định chi tiết Bộ luật lao động năm 2019.',
    summary: 'Nghị định hướng dẫn thi hành một số điều của Bộ luật Lao động về điều kiện lao động và quan hệ lao động.',
    tags: ['nghị định', 'lao động', 'pháp luật'],
    subject: 'Pháp luật',
    fileUrl: '/uploads/mock_nghi_dinh.pdf',
    aiConfidence: 97
  },
  {
    title: 'Báo cáo nhân sự Q4/2023',
    content: 'Số liệu nhân sự quý 4, tuyển mới 12 người, nghỉ 2 người.',
    summary: 'Báo cáo tổng hợp tình hình nhân sự Q4/2023 bao gồm biến động nhân sự, tuyển dụng.',
    tags: ['báo cáo', 'nhân sự', 'quý 4'],
    subject: 'Nhân sự',
    fileUrl: '/uploads/mock_bao_cao.pdf',
    aiConfidence: 72
  },
  {
    title: 'Tài liệu đào tạo an toàn lao động',
    content: 'Hướng dẫn PCCC, thoát hiểm, các biện pháp sử dụng điện an toàn cho xưởng.',
    summary: 'Tài liệu đào tạo nội bộ về an toàn lao động, phòng cháy chữa cháy và sơ cấp cứu ban đầu.',
    tags: ['đào tạo', 'an toàn', 'lao động'],
    subject: 'Học tập',
    fileUrl: '/uploads/mock_dao_tao.pdf',
    aiConfidence: 85
  },
  {
    title: 'Luật Bảo hiểm xã hội 2014',
    content: 'Văn bản luật bảo hiểm xã hội Việt Nam.',
    summary: 'Luật quy định chế độ, chính sách bảo hiểm xã hội; quyền và trách nhiệm của người lao động.',
    tags: ['luật', 'BHXH', 'bảo hiểm'],
    subject: 'Pháp luật',
    fileUrl: '/uploads/mock_luat_bhxh.pdf',
    aiConfidence: 96
  }
];

module.exports = documents;
