const token = (kind, text) => ({ kind, text });
const keyword = (text) => token('keyword', text);
const type = (text) => token('type', text);
const number = (text) => token('number', text);
const string = (text) => token('string', text);
const name = (text) => token('function', text);
const comment = (text) => token('comment', text);
const include = (text) => token('preprocessor', text);

export const samples = {
  c: {
    label: 'C',
    filename: 'main.c',
    lines: [
      [include('#include'), ' ', string('<stdio.h>')],
      [],
      [comment('// Sum the integers from 1 through n.')],
      [keyword('static'), ' ', type('int'), ' ', name('sum_to'), '(', type('int'), ' n) {'],
      ['    ', keyword('return'), ' n * (n + ', number('1'), ') / ', number('2'), ';'],
      ['}'],
      [],
      [type('int'), ' ', name('main'), '(', type('void'), ') {'],
      ['    ', name('printf'), '(', string('"Sum: %d\\n"'), ', ', name('sum_to'), '(', number('10'), '));'],
      ['    ', keyword('return'), ' ', number('0'), ';'],
      ['}'],
    ],
  },
  cpp: {
    label: 'C++',
    filename: 'main.cpp',
    lines: [
      [include('#include'), ' ', string('<iostream>')],
      [],
      [type('int'), ' ', name('sum_to'), '(', type('int'), ' n) {'],
      ['    ', keyword('return'), ' n * (n + ', number('1'), ') / ', number('2'), ';'],
      ['}'],
      [],
      [type('int'), ' ', name('main'), '() {'],
      ['    std::cout << ', string('"Sum: "'), ' << ', name('sum_to'), '(', number('10'), ') << ', string('"\\n"'), ';'],
      ['}'],
    ],
  },
  java: {
    label: 'Java',
    filename: 'Main.java',
    lines: [
      [keyword('class'), ' ', type('Main'), ' {'],
      ['    ', keyword('static'), ' ', type('int'), ' ', name('sumTo'), '(', type('int'), ' n) {'],
      ['        ', keyword('return'), ' n * (n + ', number('1'), ') / ', number('2'), ';'],
      ['    }'],
      [],
      ['    ', keyword('public static'), ' ', type('void'), ' ', name('main'), '(', type('String'), '[] args) {'],
      ['        System.out.', name('println'), '(', string('"Sum: "'), ' + ', name('sumTo'), '(', number('10'), '));'],
      ['    }'],
      ['}'],
    ],
  },
  python: {
    label: 'Python',
    filename: 'main.py',
    lines: [
      [comment('# Sum the integers from 1 through n.')],
      [keyword('def'), ' ', name('sum_to'), '(n):'],
      ['    ', keyword('return'), ' n * (n + ', number('1'), ') // ', number('2')],
      [],
      [name('print'), '(', string('"Sum:"'), ', ', name('sum_to'), '(', number('10'), '))'],
    ],
  },
};

export function sourceText(lines) {
  return lines.map((line) => line.map((part) => typeof part === 'string' ? part : part.text).join(''))
    .join('\n') + '\n';
}
