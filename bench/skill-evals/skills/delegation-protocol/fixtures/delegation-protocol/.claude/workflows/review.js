// Reviews every changed doc under docs/ and writes a summary.
export default async function run({ agent, input }) {
  const files = await agent(
    "List every markdown file under docs/ changed since origin/main and return the paths as a JSON array.",
    {}
  );

  const reviews = [];
  for (const f of JSON.parse(files)) {
    reviews.push(
      await agent(`Read ${f} and review it for factual accuracy against the code in src/.`, {})
    );
  }

  const summary = await agent(
    `Here are the reviews, inlined in full:\n${reviews.join("\n---\n")}\nGroup them by severity and return a markdown summary.`,
    {}
  );
  return summary;
}
