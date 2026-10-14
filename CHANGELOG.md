# Changelog — TVPlay Web

> Histórico de mudanças relevantes para quem opera o sistema. Começa a partir de 2026-10-14; versões anteriores podem ser consultadas no `git log`.

---

## v1.1.92 — 2026-10-14

### Mídias
- Indicador de uso de armazenamento: barra de progresso (bytes usados vs. quota configurada), posicionada na linha de botões, à direita de "Cookies YT". Cores verde/âmbar/vermelho conforme o uso se aproxima do limite.
- Quota de armazenamento configurável em **Configurações → Mídias — Quota de Armazenamento** (em GB). Sem quota definida, a tela mostra só o total usado com um link para configurar.

### Playout — menu de ações (⋮)
- Virou um modal de verdade, **centralizado na tela** (antes era um menu pequeno ancorado ao lado do botão).
- **Sem overlay escuro** — o restante da tela (vídeo no ar, outros controles) continua visível e monitorável enquanto o modal está aberto.
- **Preview inline**: clicar na thumbnail do clipe abre o player de vídeo dentro do próprio modal, numa segunda linha — sem abrir um popup novo por cima.
- Campos **Duração** (timer de avanço) e **Horário de agendamento** lado a lado, mesma largura, cada um com botão "X" para limpar o valor.
- Badges de Duração/Agendamento na lista de itens: fundo sólido (verde/azul) em vez de transparência, mais altos e legíveis.

---

## v1.1.89 – v1.1.91 — 2026-10-14

### Playout — agendamento de exibição
- Novo recurso: agendar um horário exato (com precisão de segundos) para um item da playlist interromper a exibição em andamento e entrar no ar.
- Funciona **independente do canal estar tocando, pausado ou parado** — se o horário vencer com o canal parado, a reprodução é iniciada automaticamente nesse item.
- Após o item agendado terminar, a playlist segue a partir da posição dele (não volta para onde estava antes da interrupção).
- Indicador visual (badge) no item agendado, com precedência sobre o horário previsto.

### Playout e Roteiros — coluna de horário previsto
- Nova coluna "Horário" nas telas de playlist (`/playout` e `/roteiros`), mostrando o horário estimado de exibição de cada item — calculado a partir do início real da transmissão (se estiver ao vivo) ou do horário atual (se estiver parado/em edição).
- Menu "⋮" agrupando ações menos usadas (Timer, Upload, Remover) para liberar espaço nas linhas já densas.

### Playout — relógio ao vivo
- Relógio digital (hora local, atualizado a cada segundo) centralizado no topo da coluna de Mídias, entre os dois painéis de canal — referência rápida para comparar com os horários previstos/agendados.

### Playout — contraste e legibilidade
- Texto das colunas simples (#, Código, Título, Duração, Horário) segue regra fixa: preto em linhas de fundo claro, branco em fundo escuro.
- Cabeçalho das colunas unificado em branco (antes misturava tons de cinza diferentes sem critério).

### Correções
- Rate-limit do YouTube (erro "session has been rate-limited") travava **todas** as fontes YouTube, não só a que falhou — agora o sistema para de insistir assim que detecta o rate-limit e pausa novas tentativas por 10 min.
- `PUT` de item de playlist não conseguia limpar um agendamento (`scheduledAt: null` era ignorado).
- Agendar o item que já é o atual da playlist nunca disparava (guarda de "não pular pra si mesmo" mal aplicada).
