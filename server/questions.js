// Single source of truth for quiz timing and questions (kept strictly on the server).
export const QUESTION_TIME_SEC = 20;

export const QUESTIONS = [
  {
    id: 1,
    prompt: 'What is 4 + 3?',
    options: ['6', '7', '8', '9'],
    correctIndex: 1,
    sourceUrl: 'https://www.mathsisfun.com/numbers/addition.html',
  },
  {
    id: 2,
    prompt: 'What is 9 - 5?',
    options: ['2', '3', '4', '5'],
    correctIndex: 2,
    sourceUrl: 'https://www.mathsisfun.com/numbers/subtraction.html',
  },
  {
    id: 3,
    prompt: 'What is 6 + 2?',
    options: ['7', '8', '9', '10'],
    correctIndex: 1,
    sourceUrl: 'https://www.mathsisfun.com/numbers/addition.html',
  },
  {
    id: 4,
    prompt: 'What is 8 - 3?',
    options: ['4', '5', '6', '7'],
    correctIndex: 1,
    sourceUrl: 'https://www.mathsisfun.com/numbers/subtraction.html',
  },
  {
    id: 5,
    prompt: 'What is 5 + 4?',
    options: ['8', '9', '10', '7'],
    correctIndex: 1,
    sourceUrl: 'https://www.mathsisfun.com/numbers/addition.html',
  },
];
