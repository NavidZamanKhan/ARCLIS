import { languages } from 'monaco-editor/editor.js';

const { Class, Function: Callable, Keyword, Module, Snippet } = languages.CompletionItemKind;

function words(kind, values) {
  return values.trim().split(/\s+/).map((name) => ({ label: name, kind, insertText: name }));
}

function snippet(label, detail, insertText) {
  return { label, detail, kind: Snippet, insertText, insertTextRules: languages.CompletionItemInsertTextRule.InsertAsSnippet };
}

const cKeywords = words(Keyword, `
  break case char const continue default do double else enum float for if int long return short
  sizeof static struct switch typedef union unsigned void while
`);
const cppMembers = 'array cerr cin cout endl getline map pair set sort string vector'.split(' ');

const completions = {
  c: [
    ...cKeywords,
    ...words(Callable, 'calloc fclose fgets fopen fprintf free getchar malloc memcpy printf puts scanf strlen strcmp'),
    snippet('main', 'C program entry point', 'int main(void) {\n\t$0\n\treturn 0;\n}'),
  ],
  cpp: [
    ...cKeywords,
    ...words(Keyword, 'auto bool class constexpr delete false namespace new nullptr private public template true using'),
    ...words(Module, 'std'),
    ...cppMembers.map((member) => ({ label: 'std::' + member, kind: Module, insertText: 'std::' + member })),
    snippet('main', 'C++ program entry point', 'int main() {\n\t$0\n\treturn 0;\n}'),
  ],
  java: [
    ...words(Keyword, `
      abstract boolean break case class continue else extends final for if implements import int interface new
      package private protected public return static super switch this throw try void while
    `),
    ...words(Class, 'ArrayList Arrays Collections HashMap Math Scanner String StringBuilder System'),
    snippet('sout', 'System.out.println', 'System.out.println(${1});$0'),
    snippet('main', 'Java program entry point', 'public static void main(String[] args) {\n\t$0\n}'),
  ],
  python: [
    ...words(Keyword, `
      and as break class continue def elif else except False finally for from if import in is lambda None
      not or pass raise return True try while with yield
    `),
    ...words(Callable, 'abs dict enumerate filter float input int len list map max min open print range set sorted str sum tuple zip'),
    snippet('forin', 'Loop over a sequence', 'for ${1:item} in ${2:items}:\n\t$0'),
  ],
};

const stdMembers = cppMembers.map((member) => ({
  label: 'std::' + member, filterText: member, kind: Module, insertText: member,
}));

// Share Monaco's wildcard priority so its current-file suggestions can appear
// alongside the language catalog.
languages.registerCompletionItemProvider('*', {
  triggerCharacters: [':'],
  provideCompletionItems(model, position, context) {
    const language = model.getLanguageId();
    if (model.uri.scheme !== 'inmemory' || model.uri.authority !== 'arclis' || !Object.hasOwn(completions, language)) {
      return { suggestions: [] };
    }
    const { lineNumber, column } = position;
    const word = model.getWordUntilPosition(position);
    const prefix = model.getLineContent(lineNumber).slice(0, word.startColumn - 1);
    const inStdNamespace = language === 'cpp' && /\bstd::$/.test(prefix);
    if (!inStdNamespace && context.triggerKind === languages.CompletionTriggerKind.TriggerCharacter) {
      return { suggestions: [] };
    }
    const range = {
      startLineNumber: lineNumber, endLineNumber: lineNumber, startColumn: word.startColumn,
      endColumn: model.getWordAtPosition(position)?.endColumn ?? column,
    };
    const items = inStdNamespace ? stdMembers : completions[language];
    return { suggestions: items.map((item) => ({ ...item, range })) };
  },
});
