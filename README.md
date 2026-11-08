# Só Elétricos

Portal de classificados de veículos elétricos, desenvolvido com React + Vite, preparado para deploy na Vercel e integração com Firebase.

## Rodar localmente

1. Instale Node.js (versão 20.19+ ou 22.12+).
2. Na pasta do projeto, execute `npm install`.
3. Copie `.env.example` para `.env.local` e preencha as credenciais do Firebase.
4. Execute `npm run dev`.

## Publicar na Vercel

1. Envie esta pasta para um repositório GitHub.
2. Na Vercel, escolha **Add New → Project** e importe o repositório.
3. Framework: Vite. Build command: `npm run build`. Output directory: `dist`.
4. Cadastre na Vercel as mesmas variáveis `VITE_FIREBASE_*` do `.env.local`.
5. Faça o deploy.

## Firebase necessário

No console Firebase:
- Crie um projeto.
- Ative Authentication → Email/Password.
- Crie Firestore Database.
- Ative Storage.
- Cadastre o domínio da Vercel em Authentication → Settings → Authorized domains.

O site funciona em modo de demonstração enquanto as credenciais Firebase não forem configuradas. Nesse modo, os anúncios de exemplo são apenas demonstrativos; cadastro, publicação, upload e envio de propostas exigem Firebase configurado.

## Estrutura dos dados

Coleção pública `listings` (o e-mail fica em subcoleção privada, protegido pelas regras):
- `title`: título
- `description`: descrição
- `photoUrls`: até 6 URLs
- `ownerUid`: UID do anunciante
- `createdAt`: data de criação

O projeto inclui Cloud Functions para confirmação por código de 6 dígitos e envio de propostas por e-mail. Configure SMTP antes de publicar as funções. Exemplo de configuração:

```bash
cd functions
npm install
cd ..
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
firebase deploy --only functions,firestore:rules,storage
```

Na primeira publicação, o Firebase solicitará os parâmetros `SMTP_HOST`, `SMTP_PORT` e `MAIL_FROM`. Informe os dados do seu provedor de e-mail. Não coloque senhas SMTP no frontend.
