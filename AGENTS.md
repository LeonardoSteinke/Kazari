# Commit messages

Use Conventional Commits compatible with `@commitlint/config-conventional`:
`type(scope): emoji subject`. The scope is optional. Keep the type and subject
lowercase, omit the final period, and keep the header within 100 characters.
Use one emoji after the colon, according to the type:

- `feat`: ✨
- `fix`: 🐛
- `docs`: 📝
- `style`: 💄
- `refactor`: ♻️
- `perf`: ⚡
- `test`: ✅
- `build`: 📦
- `ci`: 👷
- `chore`: 🔧

# Interface e testes responsivos

O Kazari é mobile-first: priorize o uso no celular ao projetar ou alterar a
interface. Consulte `design/guia-de-interface.md` e verifique as mudanças em
vários tamanhos de tela, incluindo 320, 390, 768 e 1280 px, quando aplicável.
Confira texto longo, alvos de toque, rolagem, diálogos e áreas seguras. Informe
explicitamente quando a verificação em iPhone/Safari físico não for possível.
