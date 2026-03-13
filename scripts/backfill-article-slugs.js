const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  log: ["warn", "error"],
});

function slugify(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "story";
}

function parseRawMetadata(value = "") {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function main() {
  const records = await prisma.article.findMany({
    select: {
      id: true,
      title: true,
      slug: true,
      raw_content: true,
      published_at: true,
      created_at: true,
    },
    orderBy: [
      { published_at: "asc" },
      { created_at: "asc" },
    ],
  });

  const used = new Set();
  let updated = 0;

  for (const record of records) {
    const rawMetadata = parseRawMetadata(record.raw_content || "");
    const preferred = slugify(record.slug || rawMetadata.slug || record.title || record.id);
    let candidate = preferred;
    let suffix = 2;

    while (used.has(candidate)) {
      candidate = `${preferred}-${suffix}`;
      suffix += 1;
    }
    used.add(candidate);

    if (record.slug === candidate) continue;

    await prisma.article.update({
      where: { id: record.id },
      data: { slug: candidate },
    });
    updated += 1;
  }

  console.log(JSON.stringify({ total: records.length, updated }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
