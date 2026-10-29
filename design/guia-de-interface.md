# Guia de interface do Kazari

Este documento registra o padrão observado na interface atual. Ele serve de referência para novas telas e alterações; diferenças identificadas durante a revisão ainda precisam ser discutidas antes de serem corrigidas.

## Identidade

O Kazari apresenta um catálogo doméstico com aspecto editorial, acolhedor e discreto. O fundo é claro e quente, as superfícies lembram papel e as bordas são suaves. A interface usa o vermelho como destaque para ações principais, preservando bastante espaço ao redor do conteúdo. Os ícones de categorias são ilustrações lineares existentes em `web/public/categories`; a marca e os ícones de navegação ficam em `web/public/brand` e `web/public/icons`.

## Cores e tipografia

As variáveis centrais estão em `web/src/styles.css`:

- Fundo `--washi` #f6f1e7; superfície `--surface` #fbf8f1; borda `--line` #d8cfbf.
- Texto principal `--sumi` #2b2926; texto secundário `--muted` #6b655c.
- Destaque `--shu` #c8452d; verde `--matcha` #8a9a5b; tom neutro `--kinari` #e3d8c3.
- Títulos usam Shippori Mincho, com serifa; textos, controles e legendas usam Zen Kaku Gothic New.
- Pequenas legendas em caixa alta e com espaçamento entre letras introduzem as seções. Mensagens secundárias usam cor mais suave e texto menor.

## Espaçamento e composição

A escala de referência usa 2 px para detalhes e 4, 8, 12, 16, 20, 24, 32, 40 e 48 px para espaçamentos. Prefira as variáveis `--space-*` existentes a valores novos arbitrários. Áreas de toque de ações costumam ter pelo menos 44 px de altura. Os campos usam tipografia de 16 px, especialmente importante no celular.

A área principal tem largura máxima de 1100 px. No celular, o catálogo usa duas colunas de cards, passando para uma abaixo de 360 px; no desktop usa três. A lista usa uma coluna, com imagem à esquerda. Categorias e locais aparecem como badges de borda fina, com ícone e texto. O favorito aparece no canto superior esquerdo da imagem, inclusive nos detalhes.

O cabeçalho fica no topo e a navegação principal fica fixa embaixo. Respeite as áreas seguras do aparelho e o espaço reservado ao menu inferior e ao botão de adicionar. Telas de organização e ajustes usam cartões de borda fina, com uma coluna no celular e duas em telas maiores.

## Componentes e estados

- Ações principais usam fundo vermelho; ações secundárias usam contorno; ações discretas usam botão de texto. Ações destrutivas têm destaque vermelho e confirmação quando necessário.
- Campos têm fundo claro, borda fina e cantos arredondados. O seletor personalizado está em `web/src/Select.tsx`; deve continuar utilizável com teclado e acomodar opções longas.
- Em celular, diálogos aparecem como painéis na parte inferior; em desktop, ficam centralizados. Devem permitir rolagem interna e manter ações e fechamento acessíveis.
- Carregamentos iniciais usam skeletons na forma aproximada do conteúdo. Conteúdo armazenado pode aparecer enquanto a atualização ocorre em segundo plano. Respeite a preferência por movimento reduzido.
- Estados vazios, erros, conteúdo offline e dados pendentes precisam continuar distinguíveis; não apresentar erro de carregamento como lista vazia.

## Referência de revisão

Ao alterar uma tela, conferir pelo menos larguras de 320, 390, 768 e 1280 px, além de orientação, conteúdo longo, telas vazias e carregadas, diálogos, teclado, foco e contraste. Verificar navegação inferior e áreas seguras em aparelhos reais, especialmente Safari no iPhone. Não há biblioteca de componentes ou documentação visual independente: o código e as variáveis atuais são a fonte dos valores observados.

## Pontos identificados na revisão de 28/10/2026

- Em Organizar, os seletores de nível pai e ícone do formulário de criação ocupam a mesma posição de grade. O seletor de nível pai fica encoberto. No desktop, o campo de nome fica estreito e sobra um espaço vazio na mesma linha.
- No catálogo em aproximadamente 390 px, o seletor de ordenação corta o texto de opções como “Atualização recente”. Em 320 px, o placeholder do nome do novo espaço também fica cortado ao lado do botão Criar.
- Os rótulos e as áreas internas dos cartões usam regras que variam entre telas e estados; é necessário validar casos de texto longo e os alinhamentos antes de consolidar uma regra única.

A inspeção visual usou Chromium em uma instância isolada com dados de exemplo, nas quatro larguras acima. Não substitui a conferência em iPhone/Safari, nem cobre todos os tamanhos de texto, fotos, permissões e estados de erro ou offline.
