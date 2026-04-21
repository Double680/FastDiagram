import "./globals.css";

export const metadata = {
  title: "自动化科学 Diagram 绘图",
  description: "中文自然语言生成可编辑 PPT Diagram 初稿"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
