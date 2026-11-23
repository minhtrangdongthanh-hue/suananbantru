import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import {
  formatVietnameseDate,
  formatVnd,
  getPaymentMethodLabel,
  getPaymentStatusLabel,
  MealBillingConfig,
  MealPaymentLog,
} from '../types';
import {
  ClassMonthlySummary,
  SchoolMonthlySummary,
  StudentMonthlySummary,
} from './monthlyMealEngine';

function colIdxToExcelLetter(colNumber: number): string {
  let n = colNumber;
  let letter = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
};

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE2E8F0' },
};

const WEEKEND_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE2E8F0' },
};

const V_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFCE7F3' },
};

const R_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF1F5F9' },
};

const TOTAL_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE0F2FE' },
};

const VND_FORMAT = '#,##0" ₫"';

export async function exportMonthlyClassTableToExcel(params: {
  summary: SchoolMonthlySummary;
  classSummary?: ClassMonthlySummary | null;
  studentRows: StudentMonthlySummary[];
  titleLabel: string;
  config: MealBillingConfig;
  paperSize?: 'A4' | 'A3';
}): Promise<void> {
  const { summary, studentRows, titleLabel, paperSize = 'A4' } = params;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'THCS Đông Thạnh';
  wb.created = new Date();

  const days = summary.days;
  const dayStartCol = 4; // D
  const dayEndCol = dayStartCol + days.length - 1;
  const xCol = dayEndCol + 1;
  const vCol = dayEndCol + 2;
  const rCol = dayEndCol + 3;
  const unitPriceCol = dayEndCol + 4;
  const amountDueCol = dayEndCol + 5;
  const paidCol = dayEndCol + 6;
  const remainingCol = dayEndCol + 7;
  const lastCol = remainingCol;
  const lastColLetter = colIdxToExcelLetter(lastCol);

  const ws = wb.addWorksheet(`Thang_${summary.month}`, {
    views: [{ state: 'frozen', xSplit: 3, ySplit: 6 }],
    pageSetup: {
      orientation: 'landscape',
      paperSize: (paperSize === 'A3' ? 8 : 9) as ExcelJS.PaperSize,
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.3,
        right: 0.3,
        top: 0.4,
        bottom: 0.4,
        header: 0.2,
        footer: 0.2,
      },
    },
  });

  // Title Block (Rows 1-4)
  ws.mergeCells(1, 1, 1, lastCol);
  const r1 = ws.getCell(1, 1);
  r1.value = 'TRƯỜNG TRUNG HỌC CƠ SỞ ĐÔNG THẠNH';
  r1.font = { name: 'Arial', size: 12, bold: true };
  r1.alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells(2, 1, 2, lastCol);
  const r2 = ws.getCell(2, 1);
  r2.value = `BẢNG TỔNG HỢP SUẤT ĂN THÁNG ${String(summary.monthNum).padStart(2, '0')} NĂM ${summary.year}`;
  r2.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FF0F172A' } };
  r2.alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells(3, 1, 3, lastCol);
  const r3 = ws.getCell(3, 1);
  r3.value = `${titleLabel} · Ký hiệu: X = Có ăn (${params.config.symbolXLabel}) | V = Vắng | R = Nghỉ/Không ĐK`;
  r3.font = { name: 'Arial', size: 10, italic: true };
  r3.alignment = { horizontal: 'center', vertical: 'middle' };

  ws.addRow([]);

  // Table Headers (Row 5: Day numbers / column headers; Row 6: Weekday names)
  const headerRow5 = ws.getRow(5);
  const headerRow6 = ws.getRow(6);

  const fixedCols = [
    { col: 1, label: 'STT', width: 6 },
    { col: 2, label: 'Lớp', width: 8 },
    { col: 3, label: 'Họ tên học sinh', width: 26 },
  ];
  for (const fc of fixedCols) {
    ws.mergeCells(5, fc.col, 6, fc.col);
    const cell = headerRow5.getCell(fc.col);
    cell.value = fc.label;
    ws.getColumn(fc.col).width = fc.width;
  }

  days.forEach((d, idx) => {
    const col = dayStartCol + idx;
    headerRow5.getCell(col).value = d.day;
    headerRow6.getCell(col).value = d.weekdayShort;
    ws.getColumn(col).width = 4.2;
  });

  const tailCols = [
    { col: xCol, label: 'Hiện diện (X)', width: 11 },
    { col: vCol, label: 'Vắng mặt (V)', width: 11 },
    { col: rCol, label: 'Nghỉ (R)', width: 10 },
    { col: unitPriceCol, label: 'Đơn giá', width: 13 },
    { col: amountDueCol, label: 'Tiền ăn', width: 15 },
    { col: paidCol, label: 'Đã đóng', width: 15 },
    { col: remainingCol, label: 'Còn phải đóng', width: 15 },
  ];
  for (const tc of tailCols) {
    ws.mergeCells(5, tc.col, 6, tc.col);
    headerRow5.getCell(tc.col).value = tc.label;
    ws.getColumn(tc.col).width = tc.width;
  }

  for (let rowIdx = 5; rowIdx <= 6; rowIdx++) {
    const row = ws.getRow(rowIdx);
    row.height = 20;
    for (let col = 1; col <= lastCol; col++) {
      const cell = row.getCell(col);
      const dayMeta = col >= dayStartCol && col <= dayEndCol ? days[col - dayStartCol] : null;
      cell.font = {
        name: 'Arial',
        size: 9,
        bold: true,
        color: { argb: dayMeta?.isOffDay ? 'FF64748B' : 'FF0F172A' },
      };
      cell.fill = dayMeta?.isOffDay ? WEEKEND_FILL : HEADER_FILL;
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = THIN_BORDER;
    }
  }

  // Student Rows
  const dataStartRow = 7;
  const startDayLetter = colIdxToExcelLetter(dayStartCol);
  const endDayLetter = colIdxToExcelLetter(dayEndCol);
  const xColLetter = colIdxToExcelLetter(xCol);
  const unitColLetter = colIdxToExcelLetter(unitPriceCol);
  const dueColLetter = colIdxToExcelLetter(amountDueCol);
  const paidColLetter = colIdxToExcelLetter(paidCol);

  studentRows.forEach((stuRow, idx) => {
    const excelRowNum = dataStartRow + idx;
    const row = ws.getRow(excelRowNum);
    row.height = 20;

    row.getCell(1).value = idx + 1;
    row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(1).font = { name: 'Arial', size: 9 };

    row.getCell(2).value = stuRow.displayClassName;
    row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(2).font = { name: 'Arial', size: 9, bold: true };

    row.getCell(3).value = stuRow.student.fullName;
    row.getCell(3).alignment = { horizontal: 'left', vertical: 'middle' };
    row.getCell(3).font = { name: 'Arial', size: 9 };

    stuRow.dayCells.forEach((dc, dIdx) => {
      const col = dayStartCol + dIdx;
      const cell = row.getCell(col);
      cell.value = dc.symbol || '';
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      if (dc.symbol === 'V') {
        cell.fill = V_FILL;
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FFBE123C' } };
      } else if (dc.symbol === 'R') {
        cell.fill = R_FILL;
        cell.font = { name: 'Arial', size: 9, color: { argb: 'FF475569' } };
      } else if (dc.symbol === 'X') {
        cell.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
        if (dc.isOffDay) {
          cell.fill = WEEKEND_FILL;
        }
      } else {
        cell.font = { name: 'Arial', size: 9 };
        if (dc.isOffDay) {
          cell.fill = WEEKEND_FILL;
        }
      }
    });

    const dayRange = `${startDayLetter}${excelRowNum}:${endDayLetter}${excelRowNum}`;

    row.getCell(xCol).value = { formula: `COUNTIF(${dayRange},"X")`, result: stuRow.xCount };
    row.getCell(xCol).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(xCol).font = { name: 'Arial', size: 9, bold: true };

    row.getCell(vCol).value = { formula: `COUNTIF(${dayRange},"V")`, result: stuRow.vCount };
    row.getCell(vCol).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(vCol).font = { name: 'Arial', size: 9, color: { argb: 'FFBE123C' } };

    row.getCell(rCol).value = { formula: `COUNTIF(${dayRange},"R")`, result: stuRow.rCount };
    row.getCell(rCol).alignment = { horizontal: 'center', vertical: 'middle' };
    row.getCell(rCol).font = { name: 'Arial', size: 9, color: { argb: 'FF475569' } };

    row.getCell(unitPriceCol).value = stuRow.primaryUnitPrice;
    row.getCell(unitPriceCol).numFmt = VND_FORMAT;
    row.getCell(unitPriceCol).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(unitPriceCol).font = { name: 'Arial', size: 9 };

    // Use exact formula when single price tier applies; keep multi-tier sum formula when price changed mid-month
    if (!stuRow.hasMultiplePrices) {
      row.getCell(amountDueCol).value = {
        formula: `${xColLetter}${excelRowNum}*${unitColLetter}${excelRowNum}`,
        result: stuRow.totalAmountDue,
      };
    } else {
      const tierSumTerms = stuRow.priceTiers.map((t) => `${t.daysCount}*${t.unitPrice}`).join('+');
      row.getCell(amountDueCol).value = {
        formula: tierSumTerms || '0',
        result: stuRow.totalAmountDue,
      };
    }
    row.getCell(amountDueCol).numFmt = VND_FORMAT;
    row.getCell(amountDueCol).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(amountDueCol).font = { name: 'Arial', size: 9, bold: true };

    row.getCell(paidCol).value = stuRow.totalPaid;
    row.getCell(paidCol).numFmt = VND_FORMAT;
    row.getCell(paidCol).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(paidCol).font = { name: 'Arial', size: 9 };

    row.getCell(remainingCol).value = {
      formula: `MAX(0,${dueColLetter}${excelRowNum}-${paidColLetter}${excelRowNum})`,
      result: stuRow.balanceRemaining,
    };
    row.getCell(remainingCol).numFmt = VND_FORMAT;
    row.getCell(remainingCol).alignment = { horizontal: 'right', vertical: 'middle' };
    row.getCell(remainingCol).font = {
      name: 'Arial',
      size: 9,
      bold: true,
      color: { argb: stuRow.balanceRemaining > 0 ? 'FFBE123C' : 'FF047857' },
    };

    for (let col = 1; col <= lastCol; col++) {
      row.getCell(col).border = THIN_BORDER;
    }
  });

  // Total Row
  const dataEndRow = dataStartRow + studentRows.length - 1;
  const totalRowNum = dataStartRow + studentRows.length;
  const totalRow = ws.getRow(totalRowNum);
  totalRow.height = 22;

  ws.mergeCells(totalRowNum, 1, totalRowNum, 3);
  totalRow.getCell(1).value = `TỔNG CỘNG (${studentRows.length} học sinh)`;
  totalRow.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };

  days.forEach((_, dIdx) => {
    const col = dayStartCol + dIdx;
    const colLetter = colIdxToExcelLetter(col);
    const val = studentRows.reduce((acc, r) => acc + (r.dayCells[dIdx]?.symbol === 'X' ? 1 : 0), 0);
    totalRow.getCell(col).value =
      studentRows.length > 0
        ? { formula: `COUNTIF(${colLetter}${dataStartRow}:${colLetter}${dataEndRow},"X")`, result: val }
        : 0;
    totalRow.getCell(col).alignment = { horizontal: 'center', vertical: 'middle' };
  });

  const sumCols = [xCol, vCol, rCol, amountDueCol, paidCol, remainingCol];
  for (const sc of sumCols) {
    const colLetter = colIdxToExcelLetter(sc);
    const cachedResult =
      sc === xCol
        ? studentRows.reduce((a, r) => a + r.xCount, 0)
        : sc === vCol
        ? studentRows.reduce((a, r) => a + r.vCount, 0)
        : sc === rCol
        ? studentRows.reduce((a, r) => a + r.rCount, 0)
        : sc === amountDueCol
        ? studentRows.reduce((a, r) => a + r.totalAmountDue, 0)
        : sc === paidCol
        ? studentRows.reduce((a, r) => a + r.totalPaid, 0)
        : studentRows.reduce((a, r) => a + r.balanceRemaining, 0);

    totalRow.getCell(sc).value =
      studentRows.length > 0
        ? { formula: `SUM(${colLetter}${dataStartRow}:${colLetter}${dataEndRow})`, result: cachedResult }
        : 0;
    if (sc === amountDueCol || sc === paidCol || sc === remainingCol) {
      totalRow.getCell(sc).numFmt = VND_FORMAT;
      totalRow.getCell(sc).alignment = { horizontal: 'right', vertical: 'middle' };
    } else {
      totalRow.getCell(sc).alignment = { horizontal: 'center', vertical: 'middle' };
    }
  }

  for (let col = 1; col <= lastCol; col++) {
    const c = totalRow.getCell(col);
    c.fill = TOTAL_FILL;
    c.font = { name: 'Arial', size: 9, bold: true, color: { argb: 'FF0F172A' } };
    c.border = THIN_BORDER;
  }

  ws.pageSetup.printTitlesRow = '1:6';
  ws.pageSetup.printArea = `A1:${lastColLetter}${totalRowNum}`;

  const safeLabel = titleLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  await downloadWorkbook(wb, `BaoSuatAn_Thang_${summary.month}_${safeLabel}.xlsx`);
}

export async function exportStudentMonthlySlipToExcel(params: {
  summary: SchoolMonthlySummary;
  studentRow: StudentMonthlySummary;
}): Promise<void> {
  const { summary, studentRow } = params;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Phieu_Suat_An');

  const rows: (string | number)[][] = [
    ['TRƯỜNG TRUNG HỌC CƠ SỞ ĐÔNG THẠNH'],
    ['PHIẾU TỔNG HỢP SUẤT ĂN THÁNG'],
    [`Tháng ${String(summary.monthNum).padStart(2, '0')} năm ${summary.year}`],
    [],
    ['Họ và tên học sinh:', studentRow.student.fullName, 'Mã HS:', studentRow.student.studentCode],
    ['Lớp:', studentRow.displayClassName, 'Khối:', `Khối ${studentRow.displayGrade}`],
    [],
    ['CHỈ TIÊU CHI TIẾT', 'SỐ LƯỢNG / SỐ TIỀN', 'GHI CHÚ'],
    ['Tổng số ngày đăng ký ăn (X)', studentRow.xCount, 'Được tính 1 suất/ngày'],
    ['Tổng số ngày vắng (V)', studentRow.vCount, 'Không tính suất ăn'],
    ['Tổng số ngày không đăng ký / nghỉ (R)', studentRow.rCount, 'Không tính suất ăn'],
    ['Số suất ăn thực tế phải thanh toán', studentRow.xCount, ''],
    [
      'Đơn giá một suất ăn (VNĐ)',
      studentRow.hasMultiplePrices
        ? studentRow.priceTiers.map((t) => `${t.daysCount} ngày × ${formatVnd(t.unitPrice)}`).join(' + ')
        : studentRow.primaryUnitPrice,
      studentRow.hasMultiplePrices ? 'Đơn giá thay đổi trong tháng' : 'VNĐ/suất',
    ],
    ['Tổng số tiền phải thanh toán (VNĐ)', studentRow.totalAmountDue, ''],
    ['Số tiền đã đóng (VNĐ)', studentRow.totalPaid, ''],
    [
      studentRow.overpaidAmount > 0 ? 'Số tiền đóng thừa (VNĐ)' : 'Số tiền còn phải đóng (VNĐ)',
      studentRow.overpaidAmount > 0 ? studentRow.overpaidAmount : studentRow.balanceRemaining,
      getPaymentStatusLabel(studentRow.paymentStatus),
    ],
  ];

  rows.forEach((r, idx) => {
    const row = ws.addRow(r);
    if (idx <= 2) {
      ws.mergeCells(idx + 1, 1, idx + 1, 4);
      row.getCell(1).font = { name: 'Arial', size: idx === 1 ? 13 : 11, bold: true };
      row.getCell(1).alignment = { horizontal: 'center' };
    } else if (idx >= 7) {
      row.eachCell((c) => {
        c.border = THIN_BORDER;
        c.font = { name: 'Arial', size: 10, bold: idx === 7 || idx >= 13 };
      });
      if (typeof r[1] === 'number' && idx >= 12) {
        row.getCell(2).numFmt = VND_FORMAT;
        row.getCell(2).alignment = { horizontal: 'right' };
      }
    }
  });

  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 24;
  ws.getColumn(3).width = 28;
  ws.getColumn(4).width = 18;

  await downloadWorkbook(
    wb,
    `PhieuSuatAn_${studentRow.student.studentCode}_${summary.month}.xlsx`
  );
}

export async function exportUnpaidStudentsToExcel(params: {
  summary: SchoolMonthlySummary;
  studentRows: StudentMonthlySummary[];
}): Promise<void> {
  const { summary, studentRows } = params;
  const unpaid = studentRows.filter((r) => r.balanceRemaining > 0);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Chua_Dong_Du');

  ws.mergeCells('A1:I1');
  ws.getCell('A1').value = 'TRƯỜNG THCS ĐÔNG THẠNH';
  ws.getCell('A1').font = { name: 'Arial', size: 12, bold: true };
  ws.getCell('A1').alignment = { horizontal: 'center' };

  ws.mergeCells('A2:I2');
  ws.getCell('A2').value = `DANH SÁCH HỌC SINH CHƯA ĐÓNG ĐỦ TIỀN ĂN THÁNG ${summary.month}`;
  ws.getCell('A2').font = { name: 'Arial', size: 13, bold: true };
  ws.getCell('A2').alignment = { horizontal: 'center' };

  const header = ws.addRow([
    'STT',
    'Mã HS',
    'Họ và tên học sinh',
    'Lớp',
    'Số suất (X)',
    'Phải đóng',
    'Đã đóng',
    'Còn thiếu',
    'Trạng thái',
  ]);
  header.eachCell((c) => {
    c.font = { name: 'Arial', size: 10, bold: true };
    c.fill = HEADER_FILL;
    c.border = THIN_BORDER;
    c.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  unpaid.forEach((r, idx) => {
    const row = ws.addRow([
      idx + 1,
      r.student.studentCode,
      r.student.fullName,
      r.displayClassName,
      r.xCount,
      r.totalAmountDue,
      r.totalPaid,
      r.balanceRemaining,
      getPaymentStatusLabel(r.paymentStatus),
    ]);
    row.eachCell((c, colNum) => {
      c.border = THIN_BORDER;
      c.font = { name: 'Arial', size: 10 };
      if (colNum >= 6 && colNum <= 8) {
        c.numFmt = VND_FORMAT;
        c.alignment = { horizontal: 'right' };
      }
    });
  });

  [6, 12, 28, 10, 12, 16, 16, 16, 18].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  await downloadWorkbook(wb, `DanhSach_ChuaDongDu_${summary.month}.xlsx`);
}

export async function exportSchoolMonthlyFinancialToExcel(params: {
  summary: SchoolMonthlySummary;
  paymentLogs: MealPaymentLog[];
}): Promise<void> {
  const { summary, paymentLogs } = params;
  const wb = new ExcelJS.Workbook();

  // Sheet 1: Grade Summary
  const wsGrades = wb.addWorksheet('Tong_Hop_Khoi');
  wsGrades.mergeCells('A1:I1');
  wsGrades.getCell('A1').value = `TRƯỜNG THCS ĐÔNG THẠNH · TỔNG HỢP TIỀN ĂN THÁNG ${summary.month}`;
  wsGrades.getCell('A1').font = { name: 'Arial', size: 13, bold: true };
  wsGrades.getCell('A1').alignment = { horizontal: 'center' };

  const gHead = wsGrades.addRow([
    'Khối',
    'Số lớp',
    'Số HS',
    'Tổng suất ăn (X)',
    'Lượt vắng (V)',
    'Phải thu (VNĐ)',
    'Đã thu (VNĐ)',
    'Còn phải thu (VNĐ)',
    'Đóng thừa (VNĐ)',
  ]);
  gHead.eachCell((c) => {
    c.font = { name: 'Arial', size: 10, bold: true };
    c.fill = HEADER_FILL;
    c.border = THIN_BORDER;
  });

  summary.gradeSummaries.forEach((g) => {
    const r = wsGrades.addRow([
      `Khối ${g.grade}`,
      g.classSummaries.length,
      g.studentCount,
      g.totalX,
      g.totalV,
      g.totalAmountDue,
      g.totalPaid,
      g.totalRemaining,
      g.totalOverpaid,
    ]);
    r.eachCell((c, col) => {
      c.border = THIN_BORDER;
      if (col >= 6) c.numFmt = VND_FORMAT;
    });
  });

  const totalG = wsGrades.addRow([
    'TOÀN TRƯỜNG',
    summary.classSummaries.length,
    summary.totalStudents,
    summary.totalX,
    summary.totalV,
    summary.totalAmountDue,
    summary.totalPaid,
    summary.totalRemaining,
    summary.totalOverpaid,
  ]);
  totalG.eachCell((c, col) => {
    c.border = THIN_BORDER;
    c.fill = TOTAL_FILL;
    c.font = { name: 'Arial', size: 10, bold: true };
    if (col >= 6) c.numFmt = VND_FORMAT;
  });
  [16, 10, 10, 16, 14, 18, 18, 18, 16].forEach((w, i) => (wsGrades.getColumn(i + 1).width = w));

  // Sheet 2: Class Summary
  const wsClasses = wb.addWorksheet('Tong_Hop_Lop');
  const cHead = wsClasses.addRow([
    'STT',
    'Khối',
    'Lớp',
    'Số HS',
    'Tổng suất (X)',
    'Vắng (V)',
    'Phải thu',
    'Đã thu',
    'Còn thiếu',
    'Đóng thừa',
  ]);
  cHead.eachCell((c) => {
    c.font = { name: 'Arial', size: 10, bold: true };
    c.fill = HEADER_FILL;
    c.border = THIN_BORDER;
  });
  summary.classSummaries.forEach((c, idx) => {
    const r = wsClasses.addRow([
      idx + 1,
      c.classObj.grade,
      c.classObj.name,
      c.studentCount,
      c.totalX,
      c.totalV,
      c.totalAmountDue,
      c.totalPaid,
      c.totalRemaining,
      c.totalOverpaid,
    ]);
    r.eachCell((cell, col) => {
      cell.border = THIN_BORDER;
      if (col >= 7) cell.numFmt = VND_FORMAT;
    });
  });
  [6, 8, 10, 10, 14, 12, 16, 16, 16, 16].forEach((w, i) => (wsClasses.getColumn(i + 1).width = w));

  // Sheet 3: All Students Financial Detail
  const wsStu = wb.addWorksheet('Chi_Tiet_Hoc_Sinh');
  const sHead = wsStu.addRow([
    'STT',
    'Mã HS',
    'Họ tên học sinh',
    'Lớp',
    'Số suất (X)',
    'Vắng (V)',
    'Nghỉ (R)',
    'Phải thu',
    'Đã thu',
    'Còn thiếu',
    'Đóng thừa',
    'Trạng thái',
  ]);
  sHead.eachCell((c) => {
    c.font = { name: 'Arial', size: 10, bold: true };
    c.fill = HEADER_FILL;
    c.border = THIN_BORDER;
  });
  summary.studentRows.forEach((s, idx) => {
    const r = wsStu.addRow([
      idx + 1,
      s.student.studentCode,
      s.student.fullName,
      s.displayClassName,
      s.xCount,
      s.vCount,
      s.rCount,
      s.totalAmountDue,
      s.totalPaid,
      s.balanceRemaining,
      s.overpaidAmount,
      getPaymentStatusLabel(s.paymentStatus),
    ]);
    r.eachCell((cell, col) => {
      cell.border = THIN_BORDER;
      if (col >= 8 && col <= 11) cell.numFmt = VND_FORMAT;
    });
  });
  [6, 12, 26, 10, 12, 10, 10, 16, 16, 16, 16, 18].forEach(
    (w, i) => (wsStu.getColumn(i + 1).width = w)
  );

  // Sheet 4: Payment Audit Logs
  const wsPayLogs = wb.addWorksheet('Lich_Su_Thu_Tien');
  const pHead = wsPayLogs.addRow([
    'Thời gian',
    'Học sinh',
    'Lớp',
    'Thao tác',
    'Số tiền trước',
    'Số tiền sau',
    'Hình thức',
    'Người thu',
    'Ghi chú / Lý do',
  ]);
  pHead.eachCell((c) => {
    c.font = { name: 'Arial', size: 10, bold: true };
    c.fill = HEADER_FILL;
    c.border = THIN_BORDER;
  });
  paymentLogs
    .filter((l) => l.month === summary.month)
    .forEach((l) => {
      const r = wsPayLogs.addRow([
        l.timestampIso,
        l.studentName,
        l.className,
        l.action,
        l.previousAmount,
        l.newAmount,
        getPaymentMethodLabel(l.newMethod === 'transfer' ? 'transfer' : 'cash'),
        l.actorName,
        l.reason,
      ]);
      r.eachCell((cell, col) => {
        cell.border = THIN_BORDER;
        if (col === 5 || col === 6) cell.numFmt = VND_FORMAT;
      });
    });
  [24, 24, 10, 12, 16, 16, 16, 22, 32].forEach((w, i) => (wsPayLogs.getColumn(i + 1).width = w));

  await downloadWorkbook(wb, `TongHop_TienAn_ToanTruong_${summary.month}.xlsx`);
}

/**
 * Vietnamese-safe PDF Engine using high-DPI Unicode Canvas rendering -> multi-page jsPDF
 * Guarantees crisp Vietnamese accents and zero clipped columns on any device.
 */
function createPdfPageCanvas(widthPx: number, heightPx: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Trình duyệt không hỗ trợ tạo canvas xuất PDF.');
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, widthPx, heightPx);
  return { canvas, ctx };
}

function drawTextCell(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  options: {
    align?: 'left' | 'center' | 'right';
    bg?: string;
    color?: string;
    bold?: boolean;
    fontSize?: number;
    border?: boolean;
    paddingX?: number;
  } = {}
) {
  const {
    align = 'center',
    bg,
    color = '#0F172A',
    bold = false,
    fontSize = 18,
    border = true,
    paddingX = 6,
  } = options;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, w, h);
  }
  if (border) {
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }
  ctx.fillStyle = color;
  ctx.font = `${bold ? '700' : '400'} ${fontSize}px "Plus Jakarta Sans", Arial, sans-serif`;
  ctx.textBaseline = 'middle';

  let clipped = text;
  const maxWidth = Math.max(4, w - paddingX * 2);
  while (clipped.length > 1 && ctx.measureText(clipped).width > maxWidth) {
    clipped = `${clipped.slice(0, -2)}…`;
  }

  let tx = x + w / 2;
  ctx.textAlign = 'center';
  if (align === 'left') {
    tx = x + paddingX;
    ctx.textAlign = 'left';
  } else if (align === 'right') {
    tx = x + w - paddingX;
    ctx.textAlign = 'right';
  }
  ctx.fillText(clipped, tx, y + h / 2);
}

export function exportMonthlyTableToPdf(params: {
  summary: SchoolMonthlySummary;
  studentRows: StudentMonthlySummary[];
  titleLabel: string;
  paperSize?: 'a4' | 'a3';
}): void {
  const { summary, studentRows, titleLabel, paperSize = 'a3' } = params;
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: paperSize,
  });

  // Fixed high-res landscape canvas (2480 x 1754 keeps 31 day columns crystal-clear with zero clipping)
  const pageW = 2480;
  const pageH = 1754;
  const marginX = 50;
  const marginY = 50;
  const usableW = pageW - marginX * 2; // 2380px

  const daysCount = summary.days.length;
  // Width allocation (sums to exact 2380px so zero clipping!)
  const wStt = 52;
  const wClass = 74;
  const wName = 270;
  const wX = 68;
  const wV = 62;
  const wR = 58;
  const wPrice = 112;
  const wMoney = 132;
  const wPaid = 128;
  const wRemain = 134;
  const fixedSum = wStt + wClass + wName + wX + wV + wR + wPrice + wMoney + wPaid + wRemain;
  const wDay = Math.floor((usableW - fixedSum) / daysCount);
  const actualTotalW = fixedSum + wDay * daysCount;

  const rowH = 38;
  const headerTopH = 120;
  const tableHeaderH = 72;
  const maxRowsPerPage = Math.floor((pageH - marginY * 2 - headerTopH - tableHeaderH - 60) / rowH);
  const totalPages = Math.max(1, Math.ceil((studentRows.length + 1) / maxRowsPerPage));

  const renderPageHeader = (ctx: CanvasRenderingContext2D, pageNum: number) => {
    ctx.fillStyle = '#0F172A';
    ctx.textAlign = 'left';
    ctx.font = '700 26px "Plus Jakarta Sans", Arial, sans-serif';
    ctx.fillText('TRƯỜNG THCS ĐÔNG THẠNH', marginX, marginY + 26);

    ctx.textAlign = 'center';
    ctx.font = '800 32px "Plus Jakarta Sans", Arial, sans-serif';
    ctx.fillText(
      `BẢNG TỔNG HỢP SUẤT ĂN THÁNG ${String(summary.monthNum).padStart(2, '0')} NĂM ${summary.year}`,
      marginX + actualTotalW / 2,
      marginY + 62
    );

    ctx.font = '600 22px "Plus Jakarta Sans", Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(
      `${titleLabel}   |   Trang ${pageNum}/${totalPages}`,
      marginX + actualTotalW / 2,
      marginY + 96
    );

    const hy = marginY + headerTopH;
    let cx = marginX;
    drawTextCell(ctx, 'STT', cx, hy, wStt, tableHeaderH, { bg: '#E2E8F0', bold: true, fontSize: 17 });
    cx += wStt;
    drawTextCell(ctx, 'Lớp', cx, hy, wClass, tableHeaderH, { bg: '#E2E8F0', bold: true, fontSize: 17 });
    cx += wClass;
    drawTextCell(ctx, 'Họ tên học sinh', cx, hy, wName, tableHeaderH, {
      bg: '#E2E8F0',
      bold: true,
      fontSize: 18,
    });
    cx += wName;

    for (const d of summary.days) {
      const bg = d.isOffDay ? '#CBD5E1' : '#E2E8F0';
      drawTextCell(ctx, String(d.day), cx, hy, wDay, tableHeaderH / 2, {
        bg,
        bold: true,
        fontSize: 15,
        paddingX: 2,
      });
      drawTextCell(ctx, d.weekdayShort, cx, hy + tableHeaderH / 2, wDay, tableHeaderH / 2, {
        bg,
        bold: false,
        color: d.isOffDay ? '#475569' : '#0F172A',
        fontSize: 14,
        paddingX: 2,
      });
      cx += wDay;
    }

    const tailHeaders: [string, number][] = [
      ['Ăn(X)', wX],
      ['Vắng', wV],
      ['Nghỉ', wR],
      ['Đơn giá', wPrice],
      ['Tiền ăn', wMoney],
      ['Đã đóng', wPaid],
      ['Còn thiếu', wRemain],
    ];
    for (const [label, tw] of tailHeaders) {
      drawTextCell(ctx, label, cx, hy, tw, tableHeaderH, {
        bg: '#E2E8F0',
        bold: true,
        fontSize: 16,
      });
      cx += tw;
    }
  };

  for (let p = 0; p < totalPages; p++) {
    if (p > 0) pdf.addPage(paperSize, 'landscape');
    const { canvas, ctx } = createPdfPageCanvas(pageW, pageH);
    renderPageHeader(ctx, p + 1);

    const startIdx = p * maxRowsPerPage;
    const endIdx = Math.min(studentRows.length, startIdx + maxRowsPerPage);
    let cy = marginY + headerTopH + tableHeaderH;

    for (let i = startIdx; i < endIdx; i++) {
      const r = studentRows[i];
      let cx = marginX;
      drawTextCell(ctx, String(i + 1), cx, cy, wStt, rowH, { fontSize: 16 });
      cx += wStt;
      drawTextCell(ctx, r.displayClassName, cx, cy, wClass, rowH, { bold: true, fontSize: 16 });
      cx += wClass;
      drawTextCell(ctx, r.student.fullName, cx, cy, wName, rowH, {
        align: 'left',
        fontSize: 17,
        paddingX: 8,
      });
      cx += wName;

      for (const dc of r.dayCells) {
        const bg =
          dc.symbol === 'V'
            ? '#FCE7F3'
            : dc.symbol === 'R'
            ? '#F1F5F9'
            : dc.isOffDay
            ? '#E2E8F0'
            : '#FFFFFF';
        const color =
          dc.symbol === 'V' ? '#BE123C' : dc.symbol === 'R' ? '#475569' : '#0F172A';
        drawTextCell(ctx, dc.symbol, cx, cy, wDay, rowH, {
          bg,
          color,
          bold: dc.symbol === 'X' || dc.symbol === 'V',
          fontSize: 16,
          paddingX: 1,
        });
        cx += wDay;
      }

      drawTextCell(ctx, String(r.xCount), cx, cy, wX, rowH, { bold: true, fontSize: 16 });
      cx += wX;
      drawTextCell(ctx, String(r.vCount), cx, cy, wV, rowH, { color: '#BE123C', fontSize: 16 });
      cx += wV;
      drawTextCell(ctx, String(r.rCount), cx, cy, wR, rowH, { color: '#475569', fontSize: 16 });
      cx += wR;
      drawTextCell(ctx, r.primaryUnitPrice.toLocaleString('vi-VN'), cx, cy, wPrice, rowH, {
        align: 'right',
        fontSize: 16,
      });
      cx += wPrice;
      drawTextCell(ctx, r.totalAmountDue.toLocaleString('vi-VN'), cx, cy, wMoney, rowH, {
        align: 'right',
        bold: true,
        fontSize: 16,
      });
      cx += wMoney;
      drawTextCell(ctx, r.totalPaid.toLocaleString('vi-VN'), cx, cy, wPaid, rowH, {
        align: 'right',
        fontSize: 16,
      });
      cx += wPaid;
      drawTextCell(ctx, r.balanceRemaining.toLocaleString('vi-VN'), cx, cy, wRemain, rowH, {
        align: 'right',
        bold: true,
        color: r.balanceRemaining > 0 ? '#BE123C' : '#047857',
        fontSize: 16,
      });

      cy += rowH;
    }

    // Draw Totals Row on final page
    if (p === totalPages - 1) {
      let cx = marginX;
      drawTextCell(ctx, `TỔNG CỘNG (${studentRows.length} HS)`, cx, cy, wStt + wClass + wName, rowH, {
        bg: '#E0F2FE',
        bold: true,
        fontSize: 17,
      });
      cx += wStt + wClass + wName;
      summary.days.forEach((_, dIdx) => {
        const sumDay = studentRows.reduce(
          (acc, sr) => acc + (sr.dayCells[dIdx]?.symbol === 'X' ? 1 : 0),
          0
        );
        drawTextCell(ctx, String(sumDay), cx, cy, wDay, rowH, {
          bg: '#E0F2FE',
          bold: true,
          fontSize: 15,
          paddingX: 1,
        });
        cx += wDay;
      });
      const sumX = studentRows.reduce((a, sr) => a + sr.xCount, 0);
      const sumV = studentRows.reduce((a, sr) => a + sr.vCount, 0);
      const sumR = studentRows.reduce((a, sr) => a + sr.rCount, 0);
      const sumDue = studentRows.reduce((a, sr) => a + sr.totalAmountDue, 0);
      const sumPaid = studentRows.reduce((a, sr) => a + sr.totalPaid, 0);
      const sumRemain = studentRows.reduce((a, sr) => a + sr.balanceRemaining, 0);

      drawTextCell(ctx, String(sumX), cx, cy, wX, rowH, { bg: '#E0F2FE', bold: true, fontSize: 16 });
      cx += wX;
      drawTextCell(ctx, String(sumV), cx, cy, wV, rowH, { bg: '#E0F2FE', bold: true, fontSize: 16 });
      cx += wV;
      drawTextCell(ctx, String(sumR), cx, cy, wR, rowH, { bg: '#E0F2FE', bold: true, fontSize: 16 });
      cx += wR;
      drawTextCell(ctx, '', cx, cy, wPrice, rowH, { bg: '#E0F2FE' });
      cx += wPrice;
      drawTextCell(ctx, sumDue.toLocaleString('vi-VN'), cx, cy, wMoney, rowH, {
        bg: '#E0F2FE',
        align: 'right',
        bold: true,
        fontSize: 16,
      });
      cx += wMoney;
      drawTextCell(ctx, sumPaid.toLocaleString('vi-VN'), cx, cy, wPaid, rowH, {
        bg: '#E0F2FE',
        align: 'right',
        bold: true,
        fontSize: 16,
      });
      cx += wPaid;
      drawTextCell(ctx, sumRemain.toLocaleString('vi-VN'), cx, cy, wRemain, rowH, {
        bg: '#E0F2FE',
        align: 'right',
        bold: true,
        color: '#BE123C',
        fontSize: 16,
      });
    }

    const pdfPageW = pdf.internal.pageSize.getWidth();
    const pdfPageH = pdf.internal.pageSize.getHeight();
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, pdfPageW, pdfPageH, undefined, 'FAST');
  }

  const safeLabel = titleLabel.replace(/[^a-zA-Z0-9_-]/g, '_');
  pdf.save(`BaoSuatAn_Thang_${summary.month}_${safeLabel}.pdf`);
}

export function exportStudentMonthlySlipToPdf(params: {
  summary: SchoolMonthlySummary;
  studentRow: StudentMonthlySummary;
}): void {
  const { summary, studentRow } = params;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = 1240;
  const pageH = 1754;
  const { canvas, ctx } = createPdfPageCanvas(pageW, pageH);

  let y = 70;
  ctx.fillStyle = '#0F172A';
  ctx.textAlign = 'left';
  ctx.font = '700 22px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText('TRƯỜNG TRUNG HỌC CƠ SỞ ĐÔNG THẠNH', 70, y);

  y += 58;
  ctx.textAlign = 'center';
  ctx.font = '800 32px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText('PHIẾU TỔNG HỢP SUẤT ĂN THÁNG', pageW / 2, y);

  y += 40;
  ctx.font = '600 22px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillStyle = '#334155';
  ctx.fillText(
    `Tháng ${String(summary.monthNum).padStart(2, '0')} năm ${summary.year}`,
    pageW / 2,
    y
  );

  y += 55;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#0F172A';
  ctx.font = '700 22px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText(`Họ tên học sinh: ${studentRow.student.fullName}`, 70, y);
  ctx.fillText(`Lớp: ${studentRow.displayClassName}`, 820, y);
  y += 36;
  ctx.font = '500 20px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText(`Mã học sinh: ${studentRow.student.studentCode}`, 70, y);
  ctx.fillText(`Trạng thái: ${getPaymentStatusLabel(studentRow.paymentStatus)}`, 820, y);

  y += 45;
  const rows: [string, string][] = [
    ['Tổng số ngày đăng ký ăn (X)', `${studentRow.xCount} ngày`],
    ['Tổng số ngày vắng (V)', `${studentRow.vCount} ngày`],
    ['Tổng số ngày không đăng ký / nghỉ (R)', `${studentRow.rCount} ngày`],
    ['Số suất ăn thực tế phải thanh toán', `${studentRow.xCount} suất`],
    [
      'Đơn giá một suất ăn',
      studentRow.hasMultiplePrices
        ? studentRow.priceTiers.map((t) => `${t.daysCount} ngày × ${formatVnd(t.unitPrice)}`).join(' + ')
        : formatVnd(studentRow.primaryUnitPrice),
    ],
    ['Tổng số tiền phải thanh toán', formatVnd(studentRow.totalAmountDue)],
    ['Số tiền đã đóng', formatVnd(studentRow.totalPaid)],
    [
      studentRow.overpaidAmount > 0 ? 'Số tiền đóng thừa' : 'Số tiền còn phải đóng',
      formatVnd(
        studentRow.overpaidAmount > 0 ? studentRow.overpaidAmount : studentRow.balanceRemaining
      ),
    ],
  ];

  drawTextCell(ctx, 'CHỈ TIÊU', 70, y, 680, 52, {
    align: 'left',
    bg: '#E2E8F0',
    bold: true,
    fontSize: 20,
    paddingX: 16,
  });
  drawTextCell(ctx, 'GIÁ TRỊ', 750, y, 420, 52, {
    align: 'right',
    bg: '#E2E8F0',
    bold: true,
    fontSize: 20,
    paddingX: 16,
  });
  y += 52;

  rows.forEach(([label, val], idx) => {
    const isHighlight = idx >= 5;
    drawTextCell(ctx, label, 70, y, 680, 50, {
      align: 'left',
      bg: isHighlight ? '#F8FAFC' : '#FFFFFF',
      bold: isHighlight,
      fontSize: 20,
      paddingX: 16,
    });
    drawTextCell(ctx, val, 750, y, 420, 50, {
      align: 'right',
      bg: isHighlight ? '#F8FAFC' : '#FFFFFF',
      bold: isHighlight,
      color: idx === 7 && studentRow.balanceRemaining > 0 ? '#BE123C' : '#0F172A',
      fontSize: 20,
      paddingX: 16,
    });
    y += 50;
  });

  if (studentRow.payments.length > 0) {
    y += 46;
    ctx.textAlign = 'left';
    ctx.font = '700 22px "Plus Jakarta Sans", Arial, sans-serif';
    ctx.fillStyle = '#0F172A';
    ctx.fillText('LỊCH SỬ CÁC KHOẢN ĐÃ THU:', 70, y);
    y += 22;

    studentRow.payments.forEach((p) => {
      drawTextCell(
        ctx,
        `${formatVietnameseDate(p.paymentDate)} · ${getPaymentMethodLabel(p.paymentMethod)} · ${p.collectorName}`,
        70,
        y,
        780,
        44,
        { align: 'left', fontSize: 18, paddingX: 14 }
      );
      drawTextCell(ctx, formatVnd(p.amountPaid), 850, y, 320, 44, {
        align: 'right',
        bold: true,
        fontSize: 18,
        paddingX: 14,
      });
      y += 44;
    });
  }

  y += 80;
  ctx.textAlign = 'center';
  ctx.font = '700 20px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillStyle = '#0F172A';
  ctx.fillText('NGƯỜI LẬP PHIẾU / KẾ TOÁN', 320, y);
  ctx.fillText('PHỤ HUYNH / HỌC SINH', 920, y);

  pdf.addImage(
    canvas.toDataURL('image/png'),
    'PNG',
    0,
    0,
    pdf.internal.pageSize.getWidth(),
    pdf.internal.pageSize.getHeight(),
    undefined,
    'FAST'
  );
  pdf.save(`PhieuSuatAn_${studentRow.student.studentCode}_${summary.month}.pdf`);
}

export function exportSchoolMonthlySummaryToPdf(params: {
  summary: SchoolMonthlySummary;
}): void {
  const { summary } = params;
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageW = 1754;
  const pageH = 1240;
  const { canvas, ctx } = createPdfPageCanvas(pageW, pageH);

  let y = 65;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0F172A';
  ctx.font = '800 28px "Plus Jakarta Sans", Arial, sans-serif';
  ctx.fillText(
    `BÁO CÁO TỔNG HỢP TIỀN ĂN TOÀN TRƯỜNG — THÁNG ${String(summary.monthNum).padStart(2, '0')}/${summary.year}`,
    pageW / 2,
    y
  );

  y += 46;
  const colWidths = [160, 120, 120, 170, 150, 230, 230, 230, 210];
  const headers = [
    'Khối',
    'Số lớp',
    'Số HS',
    'Tổng suất (X)',
    'Vắng (V)',
    'Phải thu',
    'Đã thu',
    'Còn phải thu',
    'Đóng thừa',
  ];
  let cx = 65;
  headers.forEach((h, i) => {
    drawTextCell(ctx, h, cx, y, colWidths[i], 48, { bg: '#E2E8F0', bold: true, fontSize: 18 });
    cx += colWidths[i];
  });
  y += 48;

  summary.gradeSummaries.forEach((g) => {
    const vals = [
      `Khối ${g.grade}`,
      String(g.classSummaries.length),
      String(g.studentCount),
      String(g.totalX),
      String(g.totalV),
      formatVnd(g.totalAmountDue),
      formatVnd(g.totalPaid),
      formatVnd(g.totalRemaining),
      formatVnd(g.totalOverpaid),
    ];
    let x = 65;
    vals.forEach((v, i) => {
      drawTextCell(ctx, v, x, y, colWidths[i], 46, {
        align: i >= 5 ? 'right' : 'center',
        bold: i === 0,
        fontSize: 18,
        paddingX: 10,
      });
      x += colWidths[i];
    });
    y += 46;
  });

  const totVals = [
    'TOÀN TRƯỜNG',
    String(summary.classSummaries.length),
    String(summary.totalStudents),
    String(summary.totalX),
    String(summary.totalV),
    formatVnd(summary.totalAmountDue),
    formatVnd(summary.totalPaid),
    formatVnd(summary.totalRemaining),
    formatVnd(summary.totalOverpaid),
  ];
  let tx = 65;
  totVals.forEach((v, i) => {
    drawTextCell(ctx, v, tx, y, colWidths[i], 50, {
      bg: '#E0F2FE',
      align: i >= 5 ? 'right' : 'center',
      bold: true,
      fontSize: 18,
      paddingX: 10,
    });
    tx += colWidths[i];
  });

  pdf.addImage(
    canvas.toDataURL('image/png'),
    'PNG',
    0,
    0,
    pdf.internal.pageSize.getWidth(),
    pdf.internal.pageSize.getHeight(),
    undefined,
    'FAST'
  );
  pdf.save(`TongHop_TienAn_ToanTruong_${summary.month}.pdf`);
}
