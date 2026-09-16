# ELIM Bible Quiz - question bank format

Each file `src/quiz/bank/<category>-<difficulty>.json` is a JSON array of question objects.
Category ids: ot, nt, parables, people, verses, miracles, geography, kids, business, morality
Difficulty ids: easy, medium, hard

Question object (ALL fields required):
{
  "id": "ot-easy-001",                       // <category>-<difficulty>-<3-digit number>, unique
  "ref": { "fr": "Genèse 1:1", "en": "Genesis 1:1" },   // Bible reference proving the answer
  "fr": {
    "q": "Question en français ?",
    "options": ["Bonne réponse", "Distracteur 1", "Distracteur 2", "Distracteur 3"],
    "explain": "Une phrase courte qui explique / cite le verset."
  },
  "en": {
    "q": "Question in English?",
    "options": ["Correct answer", "Distractor 1", "Distractor 2", "Distractor 3"],
    "explain": "One short sentence explaining / quoting the verse."
  }
}

Rules:
- options[0] is ALWAYS the correct answer (the app shuffles at play time). Exactly 4 options, all distinct, all plausible.
- fr and en must be faithful translations of each other (same question, same options in the same order).
- Every question verifiable in Scripture; give the precise reference. No trick questions, no denominational controversy.
- French: Louis Segond 1910. English: World English Bible or KJV (public domain). Quote at most one short verse fragment.
- Question text < 140 chars; options < 60 chars; explain < 160 chars.
- No duplicate/near-duplicate questions inside a file; vary books, people, themes.
- easy = Sunday-school facts; medium = regular Bible readers; hard = details, numbers, lesser-known people.
- Tone: warm, respectful, French-first church community in Burkina Faso.
