const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret, defineString } = require('firebase-functions/params')
const { initializeApp } = require('firebase-admin/app')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore, Timestamp } = require('firebase-admin/firestore')
const nodemailer = require('nodemailer')
const crypto = require('crypto')

initializeApp()
const db = getFirestore()
const SMTP_HOST = defineString('SMTP_HOST')
const SMTP_PORT = defineString('SMTP_PORT', { default: '587' })
const SMTP_USER = defineSecret('SMTP_USER')
const SMTP_PASS = defineSecret('SMTP_PASS')
const MAIL_FROM = defineString('MAIL_FROM')

function mailer() {
  return nodemailer.createTransport({
    host: SMTP_HOST.value(),
    port: Number(SMTP_PORT.value()),
    secure: Number(SMTP_PORT.value()) === 465,
    auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() }
  })
}

exports.sendVerificationCode = onCall({ secrets: [SMTP_USER, SMTP_PASS], maxInstances: 5 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para confirmar seu e-mail.')
  const user = await getAuth().getUser(request.auth.uid)
  if (user.emailVerified) return { ok: true, alreadyVerified: true }
  if (!user.email) throw new HttpsError('failed-precondition', 'A conta não possui e-mail.')

  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0')
  const codeHash = crypto.createHash('sha256').update(`${request.auth.uid}:${code}`).digest('hex')
  const expiresAt = Timestamp.fromMillis(Date.now() + 10 * 60 * 1000)
  await db.collection('emailVerificationCodes').doc(request.auth.uid).set({ codeHash, expiresAt, attempts: 0, createdAt: Timestamp.now() })
  await mailer().sendMail({
    from: MAIL_FROM.value(), to: user.email,
    subject: 'Código de confirmação — Só Elétricos',
    text: `Seu código de confirmação é: ${code}\n\nEle expira em 10 minutos. Se você não solicitou, ignore esta mensagem.`
  })
  return { ok: true }
})

exports.verifyVerificationCode = onCall({ maxInstances: 5 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Faça login para confirmar seu e-mail.')
  const code = String(request.data?.code || '').trim()
  if (!/^\d{6}$/.test(code)) throw new HttpsError('invalid-argument', 'Digite um código válido de 6 dígitos.')
  const ref = db.collection('emailVerificationCodes').doc(request.auth.uid)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Solicite um novo código de confirmação.')
  const data = snap.data()
  if (data.expiresAt.toMillis() < Date.now()) {
    await ref.delete()
    throw new HttpsError('deadline-exceeded', 'O código expirou. Solicite outro.')
  }
  if ((data.attempts || 0) >= 5) {
    await ref.delete()
    throw new HttpsError('resource-exhausted', 'Limite de tentativas excedido. Solicite outro código.')
  }
  const candidate = crypto.createHash('sha256').update(`${request.auth.uid}:${code}`).digest('hex')
  if (candidate !== data.codeHash) {
    await ref.update({ attempts: (data.attempts || 0) + 1 })
    throw new HttpsError('permission-denied', 'Código incorreto.')
  }
  await getAuth().updateUser(request.auth.uid, { emailVerified: true })
  await ref.delete()
  return { ok: true }
})

exports.sendProposal = onCall({ secrets: [SMTP_USER, SMTP_PASS], maxInstances: 5 }, async (request) => {
  const listingId = String(request.data?.listingId || '').trim()
  const senderEmail = String(request.data?.senderEmail || '').trim()
  const message = String(request.data?.message || '').trim()
  if (!listingId || !/^\S+@\S+\.\S+$/.test(senderEmail) || message.length < 5 || message.length > 5000) {
    throw new HttpsError('invalid-argument', 'Confira o e-mail e a mensagem. A mensagem deve ter entre 5 e 5.000 caracteres.')
  }
  const listing = await db.collection('listings').doc(listingId).get()
  if (!listing.exists) throw new HttpsError('not-found', 'Este anúncio não está mais disponível.')
  const contact = await db.collection('listings').doc(listingId).collection('private').doc('contact').get()
  const ownerEmail = contact.data()?.ownerEmail
  if (!ownerEmail) throw new HttpsError('failed-precondition', 'O anunciante não possui e-mail de contato cadastrado.')
  await mailer().sendMail({
    from: MAIL_FROM.value(), to: ownerEmail,
    replyTo: senderEmail,
    subject: `Nova proposta para: ${listing.data().title}`,
    text: `Você recebeu uma proposta pelo anúncio "${listing.data().title}".\n\nE-mail de quem enviou: ${senderEmail}\n\nMensagem:\n${message}`
  })
  return { ok: true }
})
