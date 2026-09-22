import { highlightSegments } from "@/lib/product-search";

/**
 * Menampilkan teks dengan kata kunci pencarian disorot (`<mark>`).
 * Tanpa kata kunci (atau tanpa kecocokan) teks dirender apa adanya — tanpa
 * pembungkus tambahan supaya markup tetap ringan.
 */
export function HighlightText({
  text,
  tokens,
}: {
  text: string;
  tokens: readonly string[];
}) {
  const segments = highlightSegments(text, tokens);
  if (segments.length === 0) return null;

  return (
    <>
      {segments.map((segment, index) =>
        segment.hit ? (
          <mark key={index} className="search-hit">
            {segment.text}
          </mark>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}
