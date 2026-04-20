import type { Metadata } from "next";
import { Lora, Nunito } from "next/font/google";
import "./globals.css";
import ChatWidget from "@/components/ChatWidget";
import { ChatProvider } from "@/lib/ChatContext";

const lora = Lora({
  weight: ["400", "600", "700"],
  variable: "--font-lora",
  subsets: ["latin"],
  display: "swap",
});

const nunito = Nunito({
  weight: ["500", "600", "700", "800"],
  variable: "--font-nunito",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "MediBuddy — Your medications, explained clearly.",
  description:
    "Upload a photo of your prescription or pill bottle and get a plain-language explanation of what it is, how to take it, and what to watch for.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${lora.variable} ${nunito.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ChatProvider>
          {children}
          <ChatWidget />
        </ChatProvider>
      </body>
    </html>
  );
}
