import "./globals.css";

export const metadata = {
  title: "CodeAtlas — Developer Project Assistant",
  description:
    "Upload any project zip and walk through overview, flow, modules, and database.",
  icons: {
    icon: [{ url: "/logo-mark.png?v=11", type: "image/png" }],
    apple: [{ url: "/logo-mark.png?v=11" }],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
