# Kazari

Catálogo pessoal mobile-first e offline-first para organizar itens por espaços,
categorias hierárquicas, tags, campos personalizados e localização física.

## Incluído

- Contas isoladas; primeira conta com código master; novas contas por convite de
  uso único e validade de sete dias.
- Vários espaços pessoais por conta, isolados das outras contas da instalação.
- Itens com descrição, múltiplas categorias, tags, localização, campos
  configuráveis e link externo para compra.
- Busca por nome, descrição, tags e campos; filtros por categoria (com opção de
  incluir descendentes), tag e localização.
- Uma imagem por item. Modo otimizado converte para WebP e gera miniatura. Modo
  alta mantém o formato e os bytes enviados quando o arquivo já cabe no limite;
  acima de 10 MB ou para formatos de imagem incompatíveis, redimensiona e
  comprime para WebP até caber. Arquivo de origem pode ter até 25 MB; a cópia
  original não é guardada em paralelo.
- Mensagem de item pelo menu nativo de compartilhamento (WhatsApp, Mensagens,
  etc.). O conteúdo enviado é texto; a imagem e o espaço não são compartilhados.
  Um link interno opcional requer login na conta proprietária.
- Lixeira recuperável por sete dias, seguida por remoção automática do item e da
  imagem.
- PWA com shell offline, últimas 80 fichas consultadas e miniaturas locais,
  alterações em IndexedDB e fila idempotente para sincronização ao reconectar.
- A versão do servidor acompanha cada resposta da API; toda chamada detecta um
  deploy novo e atualiza a interface imediatamente. Há também verificação ao
  abrir, voltar ao app e a cada 15 minutos quando ele está ocioso. A atualização
  limpa o cache antigo sem apagar a fila offline.

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

