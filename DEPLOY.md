## Versão atual: v28

A v27 integra as fontes/bibliografia do edital cadastradas em MATERIAIS diretamente na Sessão de Estudo.

### Novidade da v28 — imagens nos resumos

- Imagens cadastradas em `RESUMOS.image_url` aparecem **abertas dentro da página do resumo**.
- Imagens do Google Drive são convertidas para visualização inline.
- Quando a figura está incorporada em PDF, Google Docs ou Google Slides, a própria fonte é exibida em uma prévia aberta dentro do resumo.
- O app também usa somente `MATERIAIS` diretamente relacionados à mesma aula/fonte; não busca imagens externas nem imagens genéricas por tema.
- O cache PWA foi alterado para `medicina-v28-inline-resumos`, evitando que a versão antiga fique presa no navegador após a publicação.


# App Medicina v28 — implantação completa

## Estrutura

- **Início:** painel limpo com o próximo estudo e progresso do dia.
- **Planograma:** escolhe matérias e aulas concretas a partir dos RESUMOS sincronizados.
- **Sessão de estudo:** reúne resumo, materiais, flashcards e timer na mesma página.
- **Revisão:** prioriza erros e conteúdos esquecidos.
- **Mais:** biblioteca completa e ferramentas administrativas.

## Arquivos principais

- `index.html`: versão principal para publicar.
- `index_v28.html`: cópia da versão desktop/responsiva.
- `index_mobile_corrigido_v28.html`: cópia identificada para uso mobile.
- `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`: instalação PWA/offline.
- `GOOGLE_APPS_SCRIPT_QUOTA_OTIMIZADO.gs`: API entre o app e o Google Sheets.
- `appsscript.json`: manifesto básico do Apps Script.
- `vercel.json`: configuração de hospedagem estática.

## 1. Apps Script / planilha

A API usa a planilha **Medicina - Flashcards, Quizzes, Resumos e Materiais**.

Spreadsheet ID: `1h5-rvmc9h9P5VRzgAIttoJTH5FiiF9sV10b-vaSYk7k`

No Apps Script, publique `GOOGLE_APPS_SCRIPT_QUOTA_OTIMIZADO.gs` como Aplicativo da Web e copie a URL que termina em `/exec`.

## 2. Hospedagem

Publique **todos os arquivos da pasta juntos**. O arquivo inicial é `index.html`. Para PWA/offline, use HTTPS (Vercel ou hospedagem equivalente).

## 3. Conexão no app

No app, abra **Mais > Dados e sincronização**, cole a URL `/exec`, salve e sincronize.

## 4. Fluxo do planograma v28

1. O dia define famílias de matéria (por exemplo Anatomia, Histologia, Semiologia ou PMH).
2. O app consulta os **RESUMOS reais do 2º semestre sincronizados** e escolhe uma Aula concreta daquela matéria.
3. Ao tocar em **Estudar agora**, abre a aba **Sessão de estudo**.
4. A sessão reúne o resumo daquela aula, materiais rastreáveis e flashcards correspondentes.
5. O timer do bloco permanece ativo durante a sessão e ao navegar para Flashcards/Quiz.
6. Ao concluir, o app marca o bloco e abre o próximo estudo pendente.

Se não houver resumo/material específico, o app não inventa fonte; ele usa apenas os dados sincronizados disponíveis.
