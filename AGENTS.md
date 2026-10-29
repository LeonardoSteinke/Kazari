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

## Consistência dos componentes

- Quando um ajuste tratar de uma característica compartilhada (por exemplo,
  o espaçamento da seta de um seletor), procure todas as suas ocorrências e
  regras CSS que as sobrescrevem. Aplique o padrão no componente comum e
  corrija as variantes afetadas, salvo quando o usuário pedir uma exceção.
- Verifique o resultado nos contextos reais de uso, inclusive formulários,
  diálogos, estados selecionados e desabilitados e conteúdo longo. Compare
  medidas e alinhamento em diferentes larguras; confirme que os textos não
  sejam cortados nem os controles saiam da tela.
- Preserve os padrões documentados no guia de interface e atualize-o quando
  houver uma mudança deliberada em uma regra visual compartilhada. Descreva
  as verificações feitas e quaisquer limitações ao entregar a alteração.
