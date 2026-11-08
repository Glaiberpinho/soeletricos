import { useEffect, useMemo, useState } from 'react'
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from 'firebase/auth'
import {
  addDoc, collection, getDocs, query, orderBy, serverTimestamp,
  setDoc, deleteDoc, doc
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { httpsCallable } from 'firebase/functions'
import { auth, db, storage, functions, firebaseReady } from './firebase'
import { demoListings } from './demo'
import { Search, CarFront, Plus, UserRound, LogOut, ChevronLeft, ChevronRight, X, Mail, Upload, Zap, MapPin, Trash2, ArrowLeft } from 'lucide-react'

const PAGE_SIZE = 18

function AdCard({ item, onOpen }) {
  return <button className="ad-card" onClick={() => onOpen(item)}>
    <div className="ad-photo">
      <img src={item.photoUrls?.[0] || 'https://placehold.co/600x400/eaf1ed/426354?text=Foto+do+veiculo'} alt={item.title} />
      <span className="electric-tag"><Zap size={12}/> Elétrico</span>
    </div>
    <div className="ad-info">
      <h3>{item.title}</h3>
      <strong>Confira a descrição</strong>
      <small><MapPin size={13}/> Contato direto com o anunciante</small>
    </div>
  </button>
}

function App() {
  const [user, setUser] = useState(null)
  const [listings, setListings] = useState(demoListings)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(null)
  const [modal, setModal] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [pendingVerification, setPendingVerification] = useState(false)
  const [photos, setPhotos] = useState([])
  const [proposal, setProposal] = useState('')
  const [proposalEmail, setProposalEmail] = useState('')

  useEffect(() => {
    if (!firebaseReady) return
    const unsub = onAuthStateChanged(auth, setUser)
    return unsub
  }, [])

  async function loadListings() {
    if (!firebaseReady) return
    try {
      const q = query(collection(db, 'listings'), orderBy('createdAt', 'desc'))
      const snap = await getDocs(q)
      const live = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setListings(live)
    } catch (e) {
      console.error(e)
      setNotice('Não foi possível carregar os anúncios. Verifique as regras do Firestore.')
    }
  }
  useEffect(() => { loadListings() }, [])

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    if (!term) return listings
    return listings.filter(item => [item.title, item.description].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(term))
  }, [listings, search])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function doSearch(value) { setSearch(value); setPage(1) }
  async function register() {
    if (!firebaseReady) return setNotice('Configure o Firebase antes de habilitar o cadastro.')
    if (!email || password.length < 6) return setNotice('Informe um e-mail válido e uma senha com pelo menos 6 caracteres.')
    setBusy(true)
    try {
      await createUserWithEmailAndPassword(auth, email, password)
      const sendCode = httpsCallable(functions, 'sendVerificationCode')
      await sendCode({})
      setPendingVerification(true)
      setNotice('Enviamos um código de 6 dígitos para seu e-mail.')
    } catch (e) { setNotice(firebaseError(e)) } finally { setBusy(false) }
  }
  async function login() {
    if (!firebaseReady) return setNotice('Configure o Firebase antes de habilitar o acesso.')
    setBusy(true)
    try {
      const result = await signInWithEmailAndPassword(auth, email, password)
      await result.user.reload()
      if (!result.user.emailVerified) {
        const sendCode = httpsCallable(functions, 'sendVerificationCode')
        await sendCode({})
        setPendingVerification(true)
        setNotice('Seu e-mail ainda não foi confirmado. Enviamos um novo código.')
      } else { setModal(''); setNotice('Login realizado com sucesso.') }
    } catch (e) { setNotice(firebaseError(e)) } finally { setBusy(false) }
  }
  async function verifyCode() {
    if (!verificationCode.trim()) return setNotice('Digite o código recebido por e-mail.')
    setBusy(true)
    try {
      const verify = httpsCallable(functions, 'verifyVerificationCode')
      await verify({ code: verificationCode.trim() })
      await auth.currentUser.reload()
      setPendingVerification(false); setVerificationCode(''); setModal('')
      setNotice('E-mail confirmado! Você já pode publicar anúncios.')
    } catch (e) { setNotice(firebaseError(e)) } finally { setBusy(false) }
  }

  async function publish() {
    if (!user?.emailVerified) return setNotice('Confirme seu e-mail antes de publicar anúncios.')
    if (!title.trim() || !description.trim()) return setNotice('Preencha o título e a descrição.')
    if (photos.length > 6) return setNotice('Você pode enviar no máximo 6 fotos.')
    setBusy(true)
    try {
      const photoUrls = []
      for (const file of photos) {
        const fileRef = ref(storage, `listings/${user.uid}/${Date.now()}-${file.name}`)
        await uploadBytes(fileRef, file)
        photoUrls.push(await getDownloadURL(fileRef))
      }
      const listingRef = await addDoc(collection(db, 'listings'), {
        title: title.trim(), description: description.trim(), photoUrls, ownerUid: user.uid,
        createdAt: serverTimestamp()
      })
      await setDoc(doc(db, 'listings', listingRef.id, 'private', 'contact'), { ownerEmail: user.email })
      setTitle(''); setDescription(''); setPhotos([])
      setModal(''); await loadListings(); setNotice('Anúncio publicado!')
    } catch (e) { setNotice(`Erro ao publicar: ${firebaseError(e)}`) } finally { setBusy(false) }
  }
  async function sendProposal() {
    if (!proposal.trim() || !proposalEmail.trim()) return setNotice('Informe seu e-mail e escreva uma mensagem.')
    if (selected?.demo) return setNotice('Este é um anúncio demonstrativo. As propostas estarão disponíveis nos anúncios reais.')
    if (!firebaseReady || !functions) return setNotice('Configure o serviço de envio de e-mails no Firebase.')
    setBusy(true)
    try {
      const send = httpsCallable(functions, 'sendProposal')
      await send({ listingId: selected.id, senderEmail: proposalEmail.trim(), message: proposal.trim() })
      setProposal(''); setProposalEmail(''); setNotice('Proposta enviada ao anunciante.')
    } catch (e) { setNotice(`Não foi possível enviar: ${firebaseError(e)}`) } finally { setBusy(false) }
  }
  async function removeListing(item) {
    if (!confirm('Excluir este anúncio?')) return
    try {
      await deleteDoc(doc(db, 'listings', item.id, 'private', 'contact'))
      await deleteDoc(doc(db, 'listings', item.id))
      await loadListings(); setSelected(null); setNotice('Anúncio excluído.')
    } catch (e) { setNotice(firebaseError(e)) }
  }

  return <div className="site-shell">
    <header className="header">
      <a className="brand" href="#" onClick={() => { setSelected(null); setModal('') }}>
        <span className="brand-mark"><CarFront size={25}/><Zap size={12}/></span>
        <span>SÓ<span className="brand-green">ELÉTRICOS</span><small>CLASSIFICADOS DE VEÍCULOS ELÉTRICOS</small></span>
      </a>
      <nav>
        <button className="nav-link" onClick={() => { setSelected(null); setModal('') }}>Comprar</button>
        {user?.emailVerified ? <button className="nav-link" onClick={() => setModal('publish')}><Plus size={16}/> Anunciar</button> : <button className="nav-link" onClick={() => setModal('auth')}><UserRound size={16}/> Entrar</button>}
        {user && <button className="nav-link muted" onClick={() => signOut(auth)}><LogOut size={16}/> Sair</button>}
      </nav>
    </header>

    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="eyebrow"><Zap size={14}/> O futuro é elétrico</span>
          <h1>Seu próximo carro<br/><em>é elétrico.</em></h1>
          <p>Encontre, compare e negocie veículos elétricos diretamente com os anunciantes.</p>
        </div>
      </section>

      <section className="top-ad" aria-label="Espaço publicitário superior">
        <span className="ad-label">PUBLICIDADE</span>
        <div><strong>SEU ANÚNCIO AQUI</strong><small>Espaço para banner publicitário horizontal</small></div>
      </section>

      <section className="search-panel">
        <div className="search-input-wrap"><Search size={21}/><input value={search} onChange={e => doSearch(e.target.value)} placeholder="Busque por marca, modelo, preço ou qualquer característica..." /></div>
        <button className="search-button" onClick={() => setPage(1)}>Buscar</button>
      </section>

      <div className="content-layout">
        <aside className="side-ad"><span>PUBLICIDADE</span><strong>SEU<br/>ANÚNCIO<br/>AQUI</strong><small>Banner vertical</small></aside>
        <section className="results">
          <div className="section-heading"><div><span className="eyebrow dark">VITRINE DE OPORTUNIDADES</span><h2>Carros elétricos à venda</h2></div><span className="result-count">{filtered.length} anúncios</span></div>
          {!firebaseReady && <div className="demo-note">Modo demonstração: os veículos exibidos são exemplos. Configure o Firebase para publicar anúncios reais.</div>}
          {shown.length ? <div className="ad-grid">{shown.map(item => <AdCard key={item.id} item={item} onOpen={setSelected}/>)}</div> : <div className="empty"><CarFront size={36}/><h3>Nenhum anúncio encontrado</h3><p>Tente buscar por outra marca ou modelo.</p></div>}
          {pages > 1 && <div className="pagination"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={18}/> Anterior</button><span>Página {page} de {pages}</span><button disabled={page === pages} onClick={() => setPage(p => p + 1)}>Próxima <ChevronRight size={18}/></button></div>}
        </section>
        <aside className="side-ad"><span>PUBLICIDADE</span><strong>SEU<br/>ANÚNCIO<br/>AQUI</strong><small>Banner vertical</small></aside>
      </div>
    </main>

    <footer><div className="footer-brand">SÓ<span>ELÉTRICOS</span></div><p>Classificados de veículos elétricos. Negocie diretamente com o anunciante.</p><small>© {new Date().getFullYear()} Só Elétricos. Todos os direitos reservados.</small></footer>

    {selected && <div className="overlay" onClick={() => setSelected(null)}><section className="detail-modal" onClick={e => e.stopPropagation()}>
      <button className="close" onClick={() => setSelected(null)}><X/></button>
      <div className="detail-photos">{(selected.photoUrls?.length ? selected.photoUrls : ['https://placehold.co/900x600/eaf1ed/426354?text=Sem+foto']).map((src, i) => <img key={i} src={src} alt={`${selected.title} ${i+1}`}/>)}</div>
      <div className="detail-content"><button className="back-link" onClick={() => setSelected(null)}><ArrowLeft size={15}/> Voltar aos anúncios</button><span className="eyebrow dark">VEÍCULO ELÉTRICO</span><h2>{selected.title}</h2><p className="description">{selected.description}</p>
        {user?.uid === selected.ownerUid && <button className="delete-button" onClick={() => removeListing(selected)}><Trash2 size={16}/> Excluir anúncio</button>}
        <div className="proposal-box"><h3>Gostou deste veículo?</h3><p>Envie uma proposta diretamente ao anunciante.</p><input type="email" value={proposalEmail} onChange={e => setProposalEmail(e.target.value)} placeholder="Seu e-mail"/><textarea value={proposal} onChange={e => setProposal(e.target.value)} placeholder="Escreva sua mensagem ou proposta..." rows="4"/><button className="primary full" disabled={busy} onClick={sendProposal}><Mail size={17}/> {busy ? 'Enviando...' : 'Enviar proposta'}</button></div>
      </div>
    </section></div>}

    {modal && <div className="overlay" onClick={() => setModal('')}><section className="form-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setModal('')}><X/></button>
      {modal === 'auth' && <><span className="eyebrow dark">BEM-VINDO AO SÓ ELÉTRICOS</span><h2>{pendingVerification ? 'Confirme seu e-mail' : 'Entre ou crie sua conta'}</h2><p className="form-help">{pendingVerification ? 'Digite o código de 6 dígitos que enviamos para seu e-mail.' : 'Use seu e-mail para acessar ou anunciar seu veículo.'}</p>{pendingVerification ? <><label>Código de confirmação</label><input inputMode="numeric" maxLength="6" value={verificationCode} onChange={e => setVerificationCode(e.target.value.replace(/\D/g, ''))} placeholder="000000"/><button className="primary full" disabled={busy} onClick={verifyCode}>Confirmar e-mail</button></> : <><label>E-mail</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@email.com"/><label>Senha</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres"/><button className="primary full" disabled={busy} onClick={login}>Entrar</button><button className="secondary full" disabled={busy} onClick={register}>Criar conta</button></>}</>}
      {modal === 'publish' && <><span className="eyebrow dark">ANUNCIE GRÁTIS</span><h2>Cadastre seu veículo</h2><p className="form-help">Até 6 fotos. Seu e-mail de cadastro será usado para receber propostas.</p><label>Fotos (máximo 6)</label><label className="upload-area"><Upload/><span>Escolher fotos do veículo</span><input type="file" accept="image/*" multiple onChange={e => setPhotos(Array.from(e.target.files || []).slice(0,6))}/></label><small className="file-list">{photos.map(f => f.name).join(' • ') || 'Nenhuma foto selecionada'}</small><label>Título do anúncio</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: BYD Dolphin Plus 2025"/><label>Descrição</label><textarea value={description} onChange={e => setDescription(e.target.value)} rows="5" placeholder="Descreva o veículo, ano, quilometragem, autonomia, estado de conservação..."/><button className="primary full" disabled={busy} onClick={publish}>{busy ? 'Publicando...' : 'Publicar anúncio'}</button></>}
    </section></div>}
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')}><X size={16}/></button></div>}
  </div>
}

function firebaseError(error) {
  const messages = {
    'auth/email-already-in-use': 'Este e-mail já está cadastrado.',
    'auth/invalid-email': 'E-mail inválido.',
    'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/too-many-requests': 'Muitas tentativas. Tente novamente mais tarde.',
    'storage/unauthorized': 'Sem permissão para enviar fotos. Verifique as regras do Storage.'
  }
  return messages[error?.code] || error?.message || 'Ocorreu um erro inesperado.'
}

export default App