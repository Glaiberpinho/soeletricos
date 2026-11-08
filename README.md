# Só Elétricos — Firebase para anúncios, sem e-mails

O projeto mantém **Firebase Firestore para os dados dos anúncios** e **Firebase Storage para as fotos**. A confirmação por e-mail e o envio de propostas por e-mail foram removidos.

## Como funciona
- Cadastro e login demonstrativos ficam no LocalStorage deste navegador (não são contas Firebase).
- Ao abrir o site, o Firebase cria uma sessão anônima para autorizar gravação segura de anúncios e fotos.
- Dados dos anúncios e URLs das fotos são gravados no Firestore; arquivos de imagem ficam no Storage.
- Os anúncios publicados ficam disponíveis para todos os visitantes, em qualquer dispositivo.
- Propostas ficam registradas somente no LocalStorage do navegador que as enviou. Nenhum e-mail é enviado.
- Os anúncios de exemplo continuam na vitrine.

## Configuração obrigatória do Firebase
1. No Firebase Console, habilite **Authentication → Sign-in method → Anonymous**.
2. Ative/crie o Firestore Database e o Storage.
3. Publique as regras dos arquivos `firestore.rules` e `storage.rules` no console Firebase.
4. Copie as seis configurações do app Web Firebase.
5. No GitHub, abra **Settings → Secrets and variables → Actions → New repository secret** e crie estes seis secrets: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID`.
6. Faça um novo commit para disparar o GitHub Actions e compilar o site com essas configurações.

## Importante
O login de demonstração é local ao navegador. Ele não protege identidade real nem sincroniza contas. A autenticação anônima do Firebase é usada apenas para controlar quem pode gravar/excluir anúncios e imagens. Como a autenticação anônima pode ser perdida ao limpar os dados do navegador, a propriedade de anúncios publicados pode deixar de estar acessível nessa situação. Propostas não são entregues ao anunciante, pois o envio de e-mail está desativado.

## Executar
```bash
npm install
npm run dev
npm run build
```

O `vite.config.js` mantém o caminho `/soeletricos/` no GitHub Pages.
