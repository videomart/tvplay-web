# Manual de Operações — TVPlay Web

> Sistema profissional de playout para TV. Versão atualizada em 2026-05-13.

---

## Sumário

1. [Visão Geral](#1-visão-geral)
2. [Instalação e Inicialização](#2-instalação-e-inicialização)
3. [Módulos do Sistema](#3-módulos-do-sistema)
4. [Gerenciamento de Clipes](#4-gerenciamento-de-clipes)
5. [Playlists](#5-playlists)
6. [Fontes de Entrada](#6-fontes-de-entrada)
7. [Saídas de Streaming](#7-saídas-de-streaming)
8. [Cenários de Dispositivos SDI/DeckLink/USB](#8-cenários-de-dispositivos-sdidecklinkusb)
9. [Playout — Operação ao Vivo](#9-playout--operação-ao-vivo)
10. [Gráficos de Sobreposição](#10-gráficos-de-sobreposição)
11. [Logs de Exibição](#11-logs-de-exibição)
12. [Configurações do Sistema](#12-configurações-do-sistema)
13. [Referência Rápida — Atalhos e Dicas](#13-referência-rápida--atalhos-e-dicas)
14. [Solução de Problemas](#14-solução-de-problemas)

---

## 1. Visão Geral

O TVPlay Web é um sistema de playout broadcast baseado em web, capaz de:

- Gerenciar múltiplos canais com playlists independentes
- Transmitir via RTMP, HLS Push, SRT, UDP, RTP, SDI (DeckLink)
- Aceitar entradas de fontes IP (RTMP/RTSP/HLS), YouTube/Twitch, SRT, SDI, USB e agentes externos
- Aplicar gráficos de sobreposição (logo, relógio, lower-third)
- Registrar logs automáticos de exibição
- Operar em fallback automático (tela preta, barra de cor ou entrada ao vivo)

**Credenciais padrão após seed:**

| Usuário   | Senha    | Nível    |
|-----------|----------|----------|
| admin     | admin123 | ADMIN    |
| operador  | op123    | OPERATOR |

---

## 2. Instalação e Inicialização

### Pré-requisitos

- Docker + Docker Compose V2
- Portas livres: `3001` (API), `5173` (frontend dev), `9000/9001` (MinIO), `5432` (PostgreSQL), `6379` (Redis)
- Para SRT de agentes externos: portas `4000–4020` acessíveis de fora

### Subindo o ambiente

```bash
# Clone do repositório
git clone git@github.com:videomart/tvplay-web.git
cd tvplay-web

# Build e inicialização completa
docker-compose up -d --build

# Verificar saúde
docker logs tvplay_api -f
curl http://localhost:3001/health
```

O seed roda automaticamente na primeira inicialização: cria usuários, canais e tipos de clipe padrão.

### Rebuild seletivo

```bash
docker-compose up -d --build api   # Apenas backend
docker-compose up -d --build web   # Apenas frontend
docker-compose restart             # Reiniciar sem rebuild
```

### Variáveis de ambiente relevantes

| Variável        | Padrão                          | Descrição                          |
|-----------------|---------------------------------|------------------------------------|
| DATABASE_URL    | postgresql://tvplay:...@db:5432 | Banco de dados PostgreSQL          |
| REDIS_URL       | redis://redis:6379              | Fila de tarefas                    |
| MINIO_ENDPOINT  | minio                           | Storage de HLS e thumbnails        |
| JWT_SECRET      | (alterar em produção)           | Segredo para autenticação          |
| FFMPEG_PATH     | /usr/bin/ffmpeg                 | Caminho do FFmpeg no container     |
| YTDLP_PATH      | /usr/local/bin/yt-dlp           | Caminho do yt-dlp no container     |

---

## 3. Módulos do Sistema

Acesse cada módulo pela barra lateral:

| Ícone | Módulo            | Função principal                                      |
|-------|-------------------|-------------------------------------------------------|
| 📺   | Playout           | Operação ao vivo dos canais                           |
| 📋   | Playlists         | Criação e edição de programação                       |
| 🎬   | Clipes            | Cadastro de vídeos, URLs e mídias                     |
| 👥   | Clientes          | Cadastro de anunciantes                               |
| 🏷️  | Tipos de Clipe    | Categorias com cores personalizadas                   |
| 🎥   | Fontes de Entrada | Entradas ao vivo (IP, YouTube, SDI, USB, Agente)      |
| 📡   | Saídas            | Destinos de streaming configurados por canal          |
| 🎨   | Gráficos          | Overlays de logo, relógio e lower-third               |
| 📊   | Logs              | Histórico de exibição                                 |
| ⚙️   | Configurações     | Empresa, canais e padrões do playout                  |
| 👤   | Usuários          | Gestão de usuários (somente ADMIN)                    |

---

## 4. Gerenciamento de Clipes

### Tipos de fonte

O TVPlay suporta dois modos de clipe:

#### Arquivo Físico (padrão)
- Upload de arquivo de vídeo (MP4, MXF, MTS, M2TS, etc.)
- Pipeline automático: upload → BullMQ → FFmpeg → HLS segmentado → MinIO
- Status de ingestão: **Pendente → Transcodificando → Pronto / Erro**
- Suporte a Cue-In e Cue-Out para trimming não-destrutivo

#### URL YouTube / Twitch
- Cadastre a URL pública do vídeo ou live stream
- O sistema resolve via **yt-dlp** no momento da exibição
- Funciona com YouTube (VOD e live), Twitch e outras plataformas suportadas pelo yt-dlp
- Duração padrão de 3600s (1h) para lives; ajuste no campo "Duração máx."
- Não requer upload nem transcodificação local

### Criando um clipe

1. Acesse **Clipes → Novo Clipe**
2. Selecione o **Tipo** (o código é gerado automaticamente)
3. Preencha **Título** e **Cliente** (opcional)
4. Escolha a fonte:
   - **Arquivo físico**: envie o arquivo na seção "Mídia" ou use "Upload Direto" para lote
   - **YouTube / Twitch**: cole a URL e defina duração máxima se necessário
5. Clique em **Salvar**

### Editor de trimming (arquivos físicos)

Ao editar um clipe com arquivo **Pronto**, o editor de vídeo é exibido:

- Use os botões **Marcar Cue-In** / **Marcar Cue-Out** no tempo atual do player
- Ou digite os valores diretamente nos campos (em segundos)
- A barra visual mostra a região ativa entre Cue-In e Cue-Out

### Upload em lote

Use o botão **Upload Direto** para enviar múltiplos arquivos sem criar clipes imediatamente. Os arquivos ficam como "órfãos" e podem ser vinculados ao criar ou editar um clipe.

### Modalidades de clipe

| Código | Nome           | Uso típico                    |
|--------|----------------|-------------------------------|
| BK     | Bloco          | Bloco de programa             |
| AR     | Arquivo/Reprisa| Conteúdo arquivado            |
| PT     | Vinheta        | Vinheta promocional           |
| VH     | Humor          | VT humorístico                |
| CP     | Comercial      | Publicidade                   |
| CA     | Campanha       | Campanha institucional        |
| LV     | Ao Vivo        | Insert ao vivo                |
| ID     | ID Canal       | Identidade do canal           |
| MT     | Teaser         | Material teaser               |

---

## 5. Playlists

### Criando uma playlist

1. Acesse **Playlists → Nova Playlist**
2. Defina data, nome (gerado automaticamente como `DDMMAA-N`), canal e gráfico padrão
3. Ative **Loop** para repetir indefinidamente, ou **Auto-Start** com horário de início

### Editor de playlist

- **Arraste** os itens pelo ícone de grip para reordenar
- **Busque** clipes pelo título ou código na barra lateral do editor
- Clipes sem arquivo aparecem com badge laranja "SEM ARQ" (não bloqueiam o playout, são pulados)
- Cada item tem seu próprio toggle de **Loop** individual

### Importação de roteiros

Acesse **Importar Roteiro** para carregar playlists de sistemas externos:

- **Playlist-Builder** — formato nativo (arquivo `.txt` fixed-width)
- **Media+** — formato exportado pelo sistema Media+
- Outros formatos (CSV, MOS/XML, SYSCOM) — em desenvolvimento

### Bloqueio de playlist

Uma playlist **bloqueada** não permite edição durante a transmissão ao vivo. O sistema bloqueia automaticamente ao iniciar o playout. Desbloqueie manualmente se precisar editar fora do ar.

---

## 6. Fontes de Entrada

As fontes de entrada são usadas como **sinal ao vivo** no playout (corte de entrada) e como **fallback** quando a playlist termina.

### Tipos disponíveis

| Tipo              | Protocolo           | Notas                                               |
|-------------------|---------------------|-----------------------------------------------------|
| URL — RTMP/RTSP   | Direto              | Passa a URL direto para o FFmpeg sem resolução extra |
| YouTube / Twitch  | yt-dlp              | Resolve stream automaticamente com android client   |
| SRT               | Caller ou Listener  | Configura modo, porta e passphrase                  |
| SDI               | /dev/videoX         | Dispositivo SDI no Docker (Cenários 2 e 3)          |
| USB / V4L2        | /dev/videoX         | Câmera USB ou captura local no container            |
| Agente no Host    | SRT (listener)      | Máquina remota envia via SRT (Cenário 1)            |

### Preview de fontes

Cada fonte tem um botão de **Preview** que inicia um HLS temporário via FFmpeg para visualização no navegador. Timeouts:

- RTMP/RTSP: 15 segundos (aguarda primeiro segmento)
- YouTube/SRT: 20 segundos
- HTTP/HLS direto: 8 segundos

---

## 7. Saídas de Streaming

As saídas são configuradas por canal e podem ser múltiplas simultâneas.

### Tipos de saída

| Tipo                    | Destino                                             |
|-------------------------|-----------------------------------------------------|
| RTMP                    | YouTube Live, Facebook, Twitch, CDNs                |
| HLS Push                | Servidor HLS ou CDN remoto                          |
| SRT                     | Receiver SRT (encoder IRD, outro servidor)          |
| UDP                     | Decoder UDP/MPEG-TS, IRD                            |
| RTP                     | Equipamento de broadcast com entrada RTP            |
| SDI Local               | Placa DeckLink instalada no host ou container       |
| Agente Remoto (DeckLink)| Máquina Windows/Linux com DeckLink via SRT          |

### Configuração de transcodificação

Para saídas RTMP, SRT, UDP, RTP:

- **Resolução**: 1920×1080 (Full HD), 1280×720 (HD), 854×480 (SD), ou original da fonte
- **Bitrate de vídeo**: em kbps (ex.: 4000 para Full HD)
- **Bitrate de áudio**: em kbps (ex.: 128)

Saídas SDI e Agente Remoto não reencoder: passam o sinal transcodificado pelo FFmpeg diretamente.

### Gráfico padrão da saída

Cada saída pode ter um gráfico de sobreposição padrão (identidade visual do canal). É sobreposto por qualquer gráfico de clipe ou playlist (cascata: Clipe → Playlist → Saída).

---

## 8. Cenários de Dispositivos SDI/DeckLink/USB

### Cenário 1 — Docker em Nuvem (Cloud) com DeckLink Remoto

**Situação:** O TVPlay roda em servidor cloud (ou máquina sem placa). O DeckLink está em uma máquina Windows/Linux na instalação física.

**Como funciona:**
1. No TVPlay, configure uma **Saída** do tipo **Agente Remoto (DeckLink)**
2. Defina o OS, o driver (`DECKLINK` ou `DSHOW`/`V4L2`), o nome do dispositivo e a porta SRT
3. O sistema exibe automaticamente o **comando FFmpeg** para rodar na máquina com DeckLink:
   ```
   ffmpeg -f decklink -i "DeckLink SDI" -c:v libx264 -preset ultrafast \
     -tune zerolatency -b:v 4000k -c:a aac -ar 48000 -b:a 128k \
     -f mpegts "srt://IP_DO_SERVIDOR:4010?mode=caller"
   ```
4. Execute o comando na máquina com DeckLink — ela conecta ao TVPlay via SRT
5. O TVPlay envia o sinal de playout para essa conexão

**Vantagens:** Sem driver no servidor; funciona remotamente através da internet.

**Para fontes de entrada** (receber sinal da câmera/switcher via SDI para o ar):

Configure uma **Fonte de Entrada** do tipo **Agente no Host**, que funciona da mesma forma mas em sentido inverso: a máquina remota captura e envia para o TVPlay.

---

### Cenário 2 — Docker Local com Dispositivos no Host

**Situação:** O TVPlay roda em Docker na mesma máquina física que tem a placa DeckLink ou câmera USB.

**Como funciona:**

No `docker-compose.yml`, passe o dispositivo para o container:

```yaml
services:
  api:
    devices:
      - /dev/video0:/dev/video0   # Para USB/V4L2
      # Para DeckLink, o driver precisa estar instalado no host e exposto:
      - /dev/blackmagic0:/dev/blackmagic0
```

Para DeckLink no Linux, instale o `blackmagic-io` no host e compartilhe `/dev/blackmagic*`.

**Para saída SDI:** Configure uma **Saída** do tipo **SDI Local** e informe o nome do dispositivo (`DeckLink SDI`).

**Para entrada USB/V4L2:** Configure uma **Fonte de Entrada** do tipo **USB / Captura Local** e selecione o dispositivo `/dev/video0`.

**Vantagens:** Sem latência extra de rede; o FFmpeg acessa o hardware diretamente.

---

### Cenário 3 — Docker com Drivers no Container

**Situação:** Drivers DeckLink instalados diretamente no container Docker. Usado quando o servidor é dedicado e você tem controle total da imagem.

**Como funciona:**

No `Dockerfile` do backend (ou imagem customizada), instale os drivers Blackmagic:

```dockerfile
# Exemplo — requer acordo de licença Blackmagic
RUN apt-get install -y blackmagic-desktop-video
```

Depois configure no `docker-compose.yml` com acesso privilegiado ao hardware:

```yaml
services:
  api:
    privileged: true
    devices:
      - /dev/blackmagic0:/dev/blackmagic0
```

No TVPlay, configure **Saída SDI Local** com o nome do dispositivo.

**Vantagens:** Ambiente completamente contido e reproduzível.

**Desvantagem:** Drivers Blackmagic têm restrições de licença para redistribuição; cada instalação requer configuração manual.

---

### Resumo de cenários

| Cenário | Docker onde? | DeckLink onde? | Tipo de saída     | Tipo de entrada     |
|---------|--------------|----------------|-------------------|---------------------|
| 1       | Cloud/remoto | Máquina local  | Agente Remoto     | Agente no Host      |
| 2       | Local (host) | Mesmo host     | SDI Local         | USB / SDI local     |
| 3       | Docker       | Dentro do Docker | SDI Local        | USB / SDI local     |

---

## 9. Playout — Operação ao Vivo

### Interface principal

A tela de Playout é dividida em painéis recolhíveis:

- **Monitor**: visualização do estado atual (clipe, posição, tempo)
- **Sinal / Fallback**: controle de corte de entrada e fallback
- **Saídas**: status de cada saída configurada
- **Playlist**: lista de itens com controles de transporte

### Controles de transporte

| Ação          | Resultado                                          |
|---------------|----------------------------------------------------|
| ▶ Play        | Inicia reprodução da playlist selecionada          |
| ⏸ Pause       | Pausa o timer (streaming continua no clipe atual)  |
| ⏭ Próximo     | Pula para o próximo clipe pronto                   |
| Clique no título | Pula direto para aquele item                   |
| 🔁 (item)     | Toggle de loop do item individual                  |
| 🔁 (header)   | Toggle de loop da playlist inteira                 |

### Corte de entrada (Cut to Input)

1. Selecione uma **Fonte de Entrada** no painel Sinal
2. Clique em **Cortar para Entrada**
3. O playout pausa e todas as saídas recebem o sinal da fonte selecionada

### Fallback automático

Quando a playlist termina, o sistema ativa automaticamente o fallback configurado:

| Tipo          | Comportamento                                      |
|---------------|----------------------------------------------------|
| Tela Preta    | `ffmpeg -f lavfi color=c=black` — saídas ativas    |
| Barras de Cor | `ffmpeg -f lavfi smptehdbars` — padrão SMPTE       |
| Entrada Viva  | Sinal da fonte de entrada configurada como fallback |

### Inserção ao vivo

- Use **Inserir Clipe** para adicionar um item à playlist durante a transmissão
- Use **Remover Clipe** para retirar itens sem interromper o playout
- Itens sem arquivo (badge laranja) são automaticamente pulados

### Clipes YouTube/Twitch na playlist

Clipes do tipo URL aparecem normalmente na playlist com badge azul "YouTube/Twitch". Ao chegar neles, o sistema:

1. Chama o yt-dlp para resolver a URL real (pode levar 10–15 segundos)
2. Inicia o streaming em modo ao vivo (`-c copy` sem reencoding)
3. Avança para o próximo clipe após a duração configurada

---

## 10. Gráficos de Sobreposição

### Elementos disponíveis

| Elemento    | Posição           | Configuração                    |
|-------------|-------------------|---------------------------------|
| Logo        | 4 cantos          | URL da imagem + posição         |
| Relógio     | Superior direito   | Ativa/desativa (HH:MM:SS)       |
| Lower-Third | Centralizado baixo | Texto livre                     |

### Cascata de gráficos

O sistema aplica o gráfico mais específico disponível:

```
Clipe → Playlist → Saída de Streaming
```

Se o clipe tem gráfico próprio, ele sobrepõe qualquer outro. Se não, usa o da playlist. Se não, usa o padrão da saída.

---

## 11. Logs de Exibição

Acesse **Logs** para visualizar o histórico automático de exibição:

- Cada clipe exibido gera um registro com hora de início, fim, duração e cliente
- Filtros por data, programa, cliente, status
- Exportação (futura implementação)

---

## 12. Configurações do Sistema

### Aba Empresa

- Nome da empresa (exibido na sidebar)
- Logo (upload via MinIO ou URL externa)

### Aba Canais

- Configurações por canal (fallback padrão, etc.)

### Aba Padrões de Playout

- Visibilidade padrão dos painéis na tela de playout

---

## 13. Referência Rápida — Atalhos e Dicas

**Geração automática de código de clipe:** Selecione um Tipo de Clipe antes de digitar o código — o sistema gera automaticamente no formato `TIPO000001`.

**Ordenação na listagem de clipes:** Clique nos cabeçalhos das colunas (Código, Título, Duração, Mídia) para ordenar.

**Pular clipes sem arquivo:** Clipes sem mídia (badge laranja) são ignorados automaticamente no playout.

**Logo do canal clicável:** Clique no logo/nome na sidebar para ir direto ao Playout.

**Múltiplas saídas simultâneas:** Configure quantas saídas quiser por canal — todas recebem o mesmo sinal do FFmpeg.

**Reconexão automática:** Todas as saídas reconectam automaticamente em 5 segundos se o processo FFmpeg encerrar inesperadamente.

---

## 14. Solução de Problemas

### Streaming não inicia

1. Verifique se há saídas ativas no canal (menu **Saídas**)
2. Verifique os logs do backend: `docker logs tvplay_api -f`
3. Confirme que o FFmpeg está instalado: `docker exec tvplay_api ffmpeg -version`
4. Para RTMP: verifique se a URL e a stream key estão corretas

### Clipe URL (YouTube) não toca

1. Verifique se o yt-dlp está atualizado: `docker exec tvplay_api yt-dlp --version`
2. Teste manualmente: `docker exec tvplay_api yt-dlp -g "URL_DO_VIDEO"`
3. Alguns vídeos com restrição de região ou DRM não são suportados

### Preview de câmera SDI/USB não aparece

1. Confirme que o dispositivo está acessível no container (Cenário 2/3)
2. Liste os dispositivos: `docker exec tvplay_api v4l2-ctl --list-devices`
3. Para DeckLink: `docker exec tvplay_api ffmpeg -f decklink -list_devices 1 -i dummy`

### Transcodificação travada em "Processando"

1. Verifique a fila BullMQ: `docker exec tvplay_redis redis-cli llen bull:transcode:waiting`
2. Reinicie o worker: `docker-compose restart api`
3. Verifique espaço em disco no MinIO: `docker exec tvplay_minio mc admin info myminio`

### Banco de dados — mudanças no schema

Após editar `prisma/schema.prisma`:

```bash
# Dentro do container ou localmente com o backend rodando:
docker exec tvplay_api npx prisma db push

# Se houver rename de coluna com dados:
# Execute ALTER TABLE manualmente antes de db push
```

> **Atenção:** `db push` pode causar perda de dados se renomear colunas. Prefira migrações explícitas em produção.

---

*TVPlay Web — Videomart © 2026*
