const admin = require('firebase-admin')
const nodemailer = require('nodemailer')

async function main() {
  const serviceAccountText = process.env.FIREBASE_SERVICE_ACCOUNT
  const gmailUser = process.env.GMAIL_USER
  const gmailPassword = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '')
  if (!serviceAccountText || !gmailUser || !gmailPassword) {
    throw new Error('Configure os secrets FIREBASE_SERVICE_ACCOUNT, GMAIL_USER e GMAIL_APP_PASSWORD no GitHub.')
  }

  const serviceAccount = JSON.parse(serviceAccountText)
  if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  const db = admin.firestore()
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: gmailUser, pass: gmailPassword }
  })

  const pendingSnapshot = await db.collection('proposals').where('status', '==', 'pending').limit(10).get()
  const staleSnapshot = await db.collection('proposals').where('status', '==', 'processing').limit(20).get()
  const staleCutoff = Date.now() - 15 * 60 * 1000
  const staleDocs = staleSnapshot.docs.filter(doc => {
    const timestamp = doc.data().processingAt?.toMillis?.() || 0
    return timestamp < staleCutoff
  })
  const docs = [...pendingSnapshot.docs, ...staleDocs]
  if (!docs.length) {
    console.log('Nenhuma mensagem pendente.')
    return
  }

  for (const proposalDoc of docs) {
    const proposalRef = proposalDoc.ref
    const proposal = proposalDoc.data()
    const attempts = Number(proposal.attempts || 0)
    try {
      await proposalRef.update({ status: 'processing', processingAt: admin.firestore.FieldValue.serverTimestamp() })
      const listingSnap = await db.collection('listings').doc(String(proposal.listingId || '')).get()
      if (!listingSnap.exists) throw new Error('O anúncio não existe mais.')
      const contactSnap = await db.collection('listings').doc(proposal.listingId).collection('private').doc('contact').get()
      const recipient = contactSnap.data()?.ownerEmail || listingSnap.data().ownerEmail
      if (!recipient) throw new Error('O anunciante não possui e-mail de contato cadastrado.')

      await transporter.sendMail({
        from: `Só Elétricos <${gmailUser}>`,
        to: recipient,
        replyTo: proposal.senderEmail,
        subject: `Nova mensagem sobre seu anúncio: ${listingSnap.data().title}`,
        text: `Você recebeu uma mensagem pelo Só Elétricos.\n\nAnúncio: ${listingSnap.data().title}\nE-mail de quem enviou: ${proposal.senderEmail}\n\nMensagem:\n${proposal.message}\n\nResponda diretamente a este e-mail para entrar em contato com a pessoa interessada.`
      })
      await proposalRef.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        processingAt: admin.firestore.FieldValue.delete(),
        lastError: admin.firestore.FieldValue.delete()
      })
      console.log(`Mensagem ${proposalDoc.id} enviada para o anunciante.`)
    } catch (error) {
      const nextAttempts = attempts + 1
      const permanentlyFailed = nextAttempts >= 5
      await proposalRef.update({
        status: permanentlyFailed ? 'failed' : 'pending',
        attempts: nextAttempts,
        lastError: String(error.message || error).slice(0, 500),
        processingAt: admin.firestore.FieldValue.delete()
      })
      console.error(`Falha na mensagem ${proposalDoc.id}: ${error.message || error}`)
    }
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
