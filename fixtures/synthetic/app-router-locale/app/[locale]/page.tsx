import Link from "next/link";

// A presentational divider whose `to`/`from` props carry design tokens, never paths.
function SectionDivider({ from, to }: { from: string; to: string }) { return <hr data-from={from} data-to={to} />; }

// A button styled with a colour token passed through its `to` prop: also not a link.
function BrandButton({ to, label }: { to: string; label: string }) { return <button data-color={to}>{label}</button>; }

export default function Home() {
  return (
    <main>
      <h1>Xoài Tứ Quý</h1>
      <SectionDivider from="brand" to="brand-cream" />
      <BrandButton to="brand-cream" label="Mua ngay" />
      <BrandButton to="accent-sunset-soft" label="Ưu đãi" />
      <Link href="/vi/about">Về chúng tôi</Link>
      {/* next-intl `localePrefix: "as-needed"`: literals without the locale prefix, one with an anchor */}
      <Link href="/about#team">Đội ngũ</Link>
      <Link href="/about">Giới thiệu</Link>
      <a href="/about#contact">Liên hệ</a>
    </main>
  );
}
