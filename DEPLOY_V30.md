# App Medicina v30 — publicação

O pacote contém `index.html` (desktop/responsivo), `index_mobile_corrigido_v28.html` (cópia mobile), `practice-core.js`, `practice-ui.js`, `study-studio.js`, `practice.css`, ícones, PWA e os arquivos Apps Script.

## O que foi adicionado

- **Treino inteligente:** sessões curtas com alternativas, lacunas, recordação ativa e associação de pares.
- **Modo casos e questões:** usa a aba `QUIZZES` da planilha principal, preservando gabarito, feedback e fonte.
- **Revisar dificuldades:** prioriza erros recentes e revisões vencidas.
- **Progressão:** XP, meta diária de 10 cartões, sequência de dias, pontuação inicial e cartões recuperados após erro.
- **Assistente de estudo:** por aula, gera kit, quiz, flashcards, resumo, diagrama, mnemônicos e métodos de estudo com referências.
- **Privacidade:** a chave do provedor da IA fica em `Script Properties`; não deve ser colocada no HTML ou no navegador.

## Atualizar o Apps Script

1. Abra o projeto que publica a URL `/exec` já usada pelo aplicativo.
2. Substitua o conteúdo de `GOOGLE_APPS_SCRIPT_QUOTA_OTIMIZADO.gs` pelo arquivo deste pacote.
3. Adicione `AI_ESTUDOS.gs` ao mesmo projeto.
4. Em **Configurações do projeto → Propriedades do script**, crie:

   - `OPENAI_API_KEY`: chave do provedor de IA.
   - `OPENAI_MODEL`: modelo habilitado na sua conta.
   - `STUDY_ACCESS_TOKEN`: código privado com pelo menos 24 caracteres; ele será digitado no app para liberar a geração.
   - `AI_DAILY_LIMIT`: opcional; padrão 20 gerações por dia.

5. Execute uma vez `autorizarIAEstudos()` para conceder os acessos necessários. A função apenas testa os serviços; não gera conteúdo.
6. Publique uma nova versão do aplicativo da Web, executando como sua conta e permitindo acesso conforme a configuração atual do seu projeto. Copie novamente a URL que termina em `/exec`.
7. No app: **Mais → Google Sheets → Salvar configuração → Sincronizar agora**.

A geração lê o resumo da aula e tenta consultar o documento original apenas quando a fonte cadastrada está em uma pasta cujo nome contém `semestre`. Pastas `estágios` e `resumos`, além de conteúdos de cidadania e extensão, ficam fora da geração.

## Publicar o app

Publique a pasta inteira em hospedagem HTTPS. O arquivo inicial é `index.html`; mantenha `manifest.json`, `sw.js`, `icon-192.png` e `icon-512.png` no mesmo nível. O cache PWA usa a chave `medicina-v30-dynamic-study`.

## Teste rápido

1. Abra o app e sincronize a planilha **Medicina - Flashcards, Quizzes, Resumos e Materiais**.
2. Entre em **Treino inteligente** e comece uma sessão de 5 ou 10 cartões.
3. Entre em **Assistente de estudo**, escolha uma aula e confira a configuração.
4. Depois de configurar o servidor, informe o `STUDY_ACCESS_TOKEN`, gere um material e confira os links das fontes antes de adicionar os itens ao treino.
