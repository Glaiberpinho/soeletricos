# Só Elétricos

Site de classificados de veículos elétricos, publicado no GitHub Pages e com anúncios no Firebase Firestore.

## Recursos desta versão

- Até 4 fotos por anúncio, comprimidas no navegador e gravadas como Base64 no próprio documento do Firestore.
- Limite de segurança de 700 KB para o conjunto das imagens por anúncio (abaixo do limite de 1 MiB por documento).
- Estado e município obrigatórios, carregados pela API pública do IBGE.
- Pesquisa por texto, cidade e UF.
- Mensagens para anunciantes gravadas em uma fila Firestore e enviadas pelo Gmail usando GitHub Actions, sem Cloud Functions.
- Não utiliza Firebase Storage nem Cloud Functions.

## Configuração do Firebase (plano Spark)

1. Abra o projeto `soeletricos-app-ee1e6` no Firebase Console.
2. Em Authentication > Sign-in method, habilite **Anonymous**. O site usa essa sessão técnica para autorizar a publicação de anúncios e mensagens.
3. Em Firestore Database > Rules, publique o conteúdo de `firestore.rules`.
4. Não é necessário habilitar Firebase Storage nem implantar Cloud Functions.

## Secrets necessários no GitHub

No repositório, abra Settings > Secrets and variables > Actions > New repository secret. Cadastre:

- `FIREBASE_SERVICE_ACCOUNT`: conteúdo completo do JSON da conta de serviço do Firebase (uma única linha ou JSON formatado).
- `GMAIL_USER`: endereço completo da conta Gmail que enviará as mensagens.
- `GMAIL_APP_PASSWORD`: senha de app do Google, sem espaços. Não use a senha normal da conta.

O projeto anterior já utilizava os nomes `GMAIL_USER`, `GMAIL_APP_PASSWORD` e `FIREBASE_SERVICE_ACCOUNT`; se já estiverem cadastrados e válidos, não precisa cadastrá-los novamente.

## Publicação

1. Extraia o ZIP.
2. Envie o conteúdo da pasta `soeletricos-main` para a raiz do repositório GitHub (branch `main`), substituindo os arquivos antigos.
3. Em Actions, confira a execução de **Deploy Só Elétricos no GitHub Pages**.
4. Para testar o envio de e-mail sem esperar o agendamento, abra **Enviar mensagens dos anúncios pelo Gmail** e clique em **Run workflow**.

O workflow automático consulta a fila a cada 30 minutos para ajudar a manter o uso de GitHub Actions dentro da cota gratuita de repositórios privados. O GitHub pode atrasar execuções agendadas, portanto o e-mail não é necessariamente instantâneo. Você pode usar Run workflow para processar mensagens imediatamente.

## Limitações importantes

- Firestore limita cada documento a 1 MiB. O site comprime cada foto e bloqueia a publicação quando o total das imagens passa de 700 KB; anúncios com descrição muito extensa também podem atingir o limite.
- O plano Spark tem cotas diárias de leitura, gravação e armazenamento. O uso acima das cotas pode deixar as operações indisponíveis até a renovação das cotas.
- A criação de conta e o login atuais continuam armazenados localmente no navegador. Isso não é autenticação real compartilhada entre dispositivos; a sessão anônima do Firebase é usada apenas para as regras de segurança.
- A API do IBGE precisa estar acessível no navegador para carregar estados e municípios.
- Mensagens ficam na fila do Firestore e só são processadas quando o workflow do GitHub Actions executar.
