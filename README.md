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
  Um link interno opcional requer VPN e login na conta proprietária.
- Lixeira recuperável por sete dias, seguida por remoção automática do item e da
  imagem.
- PWA com shell offline, últimas 80 fichas consultadas e miniaturas locais,
  alterações em IndexedDB e fila idempotente para sincronização ao reconectar.
- Verificação de `/api/version` ao abrir, voltar ao app e a cada 15 minutos;
  deploy novo limpa o cache antigo e recarrega a interface sem apagar a fila
  offline.

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

O hostname resolve para o IP Tailscale do host (`100.93.88.105`) por um
registro DNS only no Cloudflare. O tráfego não passa pelo Cloudflare Tunnel e o
serviço não publica portas próprias; continua acessível apenas pela LAN/VPN. A
rota HTTPS está em `config/nginx-proxy/conf.d/projects.conf`.

O certificado público é emitido pela Let's Encrypt usando validação DNS-01 do
Cloudflare. Isso valida o domínio sem expor o app ou abrir portas para a
internet. Para emitir e renovar, crie um API Token Cloudflare limitado à zona
`mockingbird.com.br`, com permissões `Zone:DNS:Edit` e `Zone:Zone:Read`, salve-o
em `deploy/cloudflare.env` conforme `deploy/cloudflare.env.example` e execute:

```sh
./deploy/renew-cloudflare-cert.sh
```

O script usa acme.sh em container temporário e grava o certificado em
`config/nginx-proxy/ssl/kazari-public/` (ignorado pelo Git). Após a primeira
emissão, configure a rota HTTPS do nginx com
[`deploy/nginx-kazari.conf`](deploy/nginx-kazari.conf) e recarregue o proxy.
Agende a execução diária no host para renovar automaticamente; o script valida
a configuração e recarrega o nginx após instalar o certificado. Não envie o
arquivo de token, certificados ou chaves ao GitHub.

Exemplo de cron (ajuste o caminho absoluto do checkout):

```cron
17 4 * * * /home/leo/workspace/Media_Server/projects/kazari/deploy/renew-cloudflare-cert.sh >> /home/leo/workspace/Media_Server/projects/kazari/data/certificate-renewal.log 2>&1
```

Antes da emissão inicial, o registro DNS `kazari.mockingbird.com.br` precisa
apontar para `100.93.88.105` e estar como **DNS only** (nuvem cinza), não
proxied. O wildcard DNS atual já resolve para esse endereço.

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

