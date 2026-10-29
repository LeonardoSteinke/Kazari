# Kazari

Catálogo pessoal mobile-first e offline-first para organizar itens por espaços,
categorias hierárquicas, campos personalizados e localização física.

## Incluído

- Contas isoladas; primeira conta com código master; novas contas por convite de
  uso único e validade de sete dias.
- Perfil com nome de exibição separado do login, foto de perfil processada em
  WebP e alteração de senha com confirmação da senha atual. A alteração de senha
  encerra as outras sessões da conta.
- Vários espaços por conta, isolados por padrão e compartilhados somente por
  convite explícito do proprietário.
- Compartilhamento de espaço por nome de usuário com papéis de editor ou leitor;
  somente o proprietário pode convidar/remover contas e renomear o espaço.
- Itens com descrição, múltiplas categorias, localização, favoritos e campos
  configuráveis. Os antigos campos de situação, compra, garantia e loja foram
  retirados da interface; valores legados permanecem preservados no banco.
- Seletores de texto e ícones sobrepostos ao conteúdo, com 24 desenhos SVG.
  O catálogo compartilhado de nomes e chaves está em `server/icons.json`.
- Busca por nome, descrição e campos; filtros por categoria (com opção de
  incluir descendentes), tag e localização.
- Uma imagem por item. Modo otimizado converte para WebP e gera miniatura. Modo
  alta mantém o formato e os bytes enviados quando o arquivo já cabe no limite;
  acima de 10 MB ou para formatos de imagem incompatíveis, redimensiona e
  comprime para WebP até caber. Arquivo de origem pode ter até 25 MB; a cópia
  original não é guardada em paralelo.
- Compartilhamento da imagem armazenada e da descrição pelo menu do aparelho,
  quando o navegador aceita compartilhar arquivos. Caso contrário, é possível
  salvar a imagem e copiar a descrição para anexar manualmente. Um link interno
  opcional requer acesso ao espaço.
- A ação de salvar imagem baixa o arquivo principal armazenado: no modo
  otimizado, ele é a versão processada; no modo de alta qualidade, pode ser o
  original enviado quando coube nos limites de tamanho e resolução.
- Lixeira recuperável por sete dias, seguida por remoção automática do item e da
  imagem.
- PWA com shell offline, últimas 80 fichas consultadas e miniaturas locais,
  alterações em IndexedDB e fila idempotente para sincronização ao reconectar.
- A versão do servidor acompanha cada resposta da API; uma versão diferente é
  confirmada antes de atualizar a interface. Há também verificação ao abrir,
  voltar ao app e a cada 15 minutos. A atualização aguarda o fechamento de
  telas abertas e o envio de alterações pendentes, preservando a fila offline.

## Stack

| Camada | Tecnologia |
|---|---|
| Interface | React 18, TypeScript, Vite |
| PWA | vite-plugin-pwa, Workbox e IndexedDB (`idb`) |
| API | Node.js 20, Express, Zod |
| Dados | SQLite via better-sqlite3, modo WAL |
| Imagens | Sharp: WebP, limite de 10 MB e miniatura por foto |
| Autenticação | bcrypt, JWT em cookie HttpOnly/SameSite e rate limit |
| Deploy | Docker multi-stage, um container atrás do nginx-proxy |

## Desenvolvimento

Configure as variáveis locais e instale as dependências:

```sh
cp .env.example .env
cd server && npm ci
DATA_DIR=./data JWT_SECRET=dev-secret MASTER_CODE=dev-master npm run dev
```

Em outro terminal:

```sh
cd web && npm ci && npm run dev
```

O frontend Vite usa proxy de `/api` para `localhost:3000`.

## Homelab e `kazari.mockingbird.com.br`

O acesso público usa o Cloudflare Tunnel existente, sem abrir portas no
roteador. O TLS termina no Cloudflare e o Tunnel encaminha para o nginx local,
que roteia ao container `kazari` na rede Docker privada. A aplicação exige
conta e senha; o primeiro cadastro precisa do `MASTER_CODE` aleatório em `.env`.
Após a primeira conta, novos cadastros só funcionam com convites gerados pelo
administrador.

A rota do origin está em `config/nginx-proxy/conf.d/projects.conf`; a regra de
ingress do Tunnel fica em `/etc/cloudflared/config.yml`. O hostname deve ter um
registro CNAME proxied gerenciado pelo Tunnel. Nenhuma chave ou token do
Cloudflare é necessário dentro do container Kazari.

Antes do primeiro deploy, configure os segredos locais em `.env` e execute:

```sh
mkdir -p data/media data/backups
docker compose up -d --build
docker compose logs -f
```

Primeiro cadastro em `https://kazari.mockingbird.com.br` usa `MASTER_CODE` e
vira administrador. Essa conta gera convites em **Ajustes**. Cada convite é
exibido uma vez, vale sete dias e cria uma conta. Os espaços e as respectivas
imagens permanecem privados para a conta que os criou.

### Dados e cópias de segurança

O volume `./data` contém `kazari.db`, `media/` e `backups/`. Fotos são arquivos
identificados por UUID; miniaturas e originais/versões processadas são gerados
no servidor, e o SQLite guarda metadados e associações. São mantidos sete
snapshots diários do banco. Inclua **todo o diretório `data/`** no backup externo
do homelab para poder restaurar banco e fotos juntos.

### Atualizar

```sh
git pull
docker compose up -d --build
```

## Decisões de sincronização

O shell e os recursos estáticos são precacheados; chamadas autenticadas da API
não são guardadas pelo service worker. O app mantém no IndexedDB as últimas 80
fichas e suas miniaturas e as operações ainda não enviadas, incluindo fotos. Os
envios de criação têm chave idempotente por cliente. A primeira versão aplica
alterações na ordem local e usa a última gravação recebida em edições concorrentes.
Se uma operação pendente receber erro de validação/permissão, ela permanece
indicada como pendente para que o usuário possa corrigir após reconectar.

