import { useEffect, useMemo, useState } from 'react'
import {
  Search, CarFront, Plus, UserRound, LogOut, ChevronLeft, ChevronRight,
  X, Mail, Upload, Zap, MapPin, Trash2, ArrowLeft
} from 'lucide-react'
import { demoListings } from './demo'
import { auth, db, storage, firebaseReady } from './firebase'
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { addDoc, collection, getDocs, query, orderBy, serverTimestamp, deleteDoc, doc } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'

const PAGE_SIZE = 18
const KEYS = { users: 'soeletricos_users_v1', session: 'soeletricos_session_v1', listings: 'soeletricos_listings_v1', proposals: 'soeletricos_proposals_v1' }

function readStore(key, fallback) {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) : fallback }
  catch { return fallback }
}
function writeStore(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true }
  catch (error) { console.error(error); return false }
}
async function passwordHash(value) {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}
function imageToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => {
      const img = new Image()
      img.onerror = reject
      img.onload = () => {
        const max = 1280
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.76))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

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
  const [user, setUser] = useState(() => readStore(KEYS.session, null))
  const [firebaseUser, setFirebaseUser] = useState(null)
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
  const [photos, setPhotos] = useState([])
  const [proposal, setProposal] = useState('')
  const [proposalEmail, setProposalEmail] = useState('')

  useEffect(() => {
    if (!firebaseReady) {
      setNotice('Firebase não configurado. Configure as variáveis VITE_FIREBASE_* para carregar e publicar anúncios na nuvem.')
      return
    }
    const unsubscribe = onAuthStateChanged(auth, current => {
      setFirebaseUser(current)
      if (!current) signInAnonymously(auth).catch(error => {
        console.error(error)
        setNotice('Não foi possível conectar ao Firebase. Verifique se o login anônimo está ativado.')
      })
    })
    loadListings()
    return unsubscribe
  }, [])

  async function loadListings() {
    if (!firebaseReady) return
    try {
      const q = query(collection(db, 'listings'), orderBy('createdAt', 'desc'))
      const snap = await getDocs(q)
      const remote = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setListings([...remote, ...demoListings])
    } catch (error) {
      console.error(error)
      setNotice('Não foi possível carregar os anúncios do Firebase. Verifique as regras do Firestore.')
    }
  }

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    if (!term) return listings
    return listings.filter(item => [item.title, item.description, item.price, item.city].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(term))
  }, [listings, search])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function doSearch(value) { setSearch(value); setPage(1) }

  async function register() {
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) return setNotice('Informe um e-mail válido.')
    if (password.length < 6) return setNotice('A senha precisa ter pelo menos 6 caracteres.')
    setBusy(true)
    try {
      const users = readStore(KEYS.users, [])
      const normalizedEmail = email.trim().toLowerCase()
      if (users.some(item => item.email === normalizedEmail)) return setNotice('Este e-mail já está cadastrado neste navegador. Faça login.')
      const account = { id: `user_${Date.now()}`, email: normalizedEmail, passwordHash: await passwordHash(password) }
      if (!writeStore(KEYS.users, [...users, account])) return setNotice('Não foi possível salvar a conta. O armazenamento do navegador pode estar cheio.')
      const session = { uid: account.id, email: account.email }
      writeStore(KEYS.session, session); setUser(session); setModal(''); setEmail(''); setPassword('')
      setNotice('Conta criada neste navegador. Você já pode publicar anúncios!')
    } catch { setNotice('Não foi possível criar a conta neste navegador.') }
    finally { setBusy(false) }
  }

  async function login() {
    if (!email.trim() || !password) return setNotice('Informe seu e-mail e sua senha.')
    setBusy(true)
    try {
      const users = readStore(KEYS.users, [])
      const normalizedEmail = email.trim().toLowerCase()
      const account = users.find(item => item.email === normalizedEmail)
      if (!account || account.passwordHash !== await passwordHash(password)) return setNotice('E-mail ou senha incorretos. A conta precisa ter sido criada neste navegador.')
      const session = { uid: account.id, email: account.email }
      writeStore(KEYS.session, session); setUser(session); setModal(''); setEmail(''); setPassword('')
      setNotice('Login realizado com sucesso!')
    } catch { setNotice('Não foi possível entrar nesta conta.') }
    finally { setBusy(false) }
  }

  function logout() {
    localStorage.removeItem(KEYS.session)
    setUser(null); setNotice('Você saiu da sua conta neste navegador.')
  }

  async function publish() {
    if (!user) return setNotice('Entre ou crie uma conta para publicar anúncios.')
    if (!firebaseReady) return setNotice('Firebase não configurado. Não é possível publicar anúncios na nuvem.')
    if (!title.trim() || !description.trim()) return setNotice('Preencha o título e a descrição.')
    if (photos.length > 6) return setNotice('Você pode enviar no máximo 6 fotos.')
    setBusy(true)
    try {
      let firebaseUser = auth.currentUser
      if (!firebaseUser) firebaseUser = (await signInAnonymously(auth)).user
      const photoUrls = []
      const uploadedPaths = []
      for (const file of photos) {
        const path = `listings/${firebaseUser.uid}/${Date.now()}-${crypto.randomUUID()}-${file.name}`
        const fileRef = ref(storage, path)
        await uploadBytes(fileRef, file, { contentType: file.type || 'image/jpeg' })
        uploadedPaths.push(path)
        photoUrls.push(await getDownloadURL(fileRef))
      }
      await addDoc(collection(db, 'listings'), {
        title: title.trim(), description: description.trim(), photoUrls, storagePaths: uploadedPaths,
        ownerUid: firebaseUser.uid, ownerEmail: user.email, createdAt: serverTimestamp()
      })
      setTitle(''); setDescription(''); setPhotos([]); setModal(''); setPage(1)
      await loadListings()
      setNotice('Anúncio e fotos publicados no Firebase. Nenhum e-mail foi enviado.')
    } catch (error) {
      console.error(error)
      setNotice(`Erro ao publicar no Firebase: ${error?.message || 'verifique as configurações e regras.'}`)
    } finally { setBusy(false) }
  }

  function sendProposal() {
    if (!proposal.trim() || !proposalEmail.trim()) return setNotice('Informe seu e-mail e escreva uma mensagem.')
    if (selected?.demo) return setNotice('Este é um anúncio de demonstração. A proposta não foi enviada.')
    const proposals = readStore(KEYS.proposals, [])
    const record = { id: `proposal_${Date.now()}`, listingId: selected.id, senderEmail: proposalEmail.trim(), message: proposal.trim(), createdAt: new Date().toISOString() }
    if (!writeStore(KEYS.proposals, [record, ...proposals])) return setNotice('Não foi possível registrar a proposta no armazenamento do navegador.')
    setProposal(''); setProposalEmail('')
    setNotice('Proposta registrada apenas neste navegador. Nenhum e-mail foi enviado ao anunciante.')
  }

  async function removeListing(item) {
    if (item.demo || item.ownerUid !== firebaseUser?.uid) return
    if (!confirm('Excluir este anúncio?')) return
    try {
      for (const path of (item.storagePaths || [])) {
        try { await deleteObject(ref(storage, path)) } catch (error) { console.warn('Foto não removida:', error) }
      }
      await deleteDoc(doc(db, 'listings', item.id))
      await loadListings()
      setSelected(null); setNotice('Anúncio excluído do Firebase.')
    } catch (error) { setNotice(`Não foi possível excluir: ${error?.message || 'erro no Firebase'}`) }
  }

  return <div className="site-shell">
    <header className="header">
      <a className="brand" href="#" onClick={() => { setSelected(null); setModal('') }}>
        <span className="brand-mark"><CarFront size={25}/><Zap size={12}/></span>
        <span>SÓ<span className="brand-green">ELÉTRICOS</span><small>CLASSIFICADOS DE VEÍCULOS ELÉTRICOS</small></span>
      </a>
      <nav>
        <button className="nav-link" onClick={() => { setSelected(null); setModal('') }}>Comprar</button>
        {user ? <button className="nav-link" onClick={() => setModal('publish')}><Plus size={16}/> Anunciar</button> : <button className="nav-link" onClick={() => setModal('auth')}><UserRound size={16}/> Entrar</button>}
        {user && <button className="nav-link muted" onClick={logout}><LogOut size={16}/> Sair</button>}
      </nav>
    </header>

    <main>
      <section className="hero"><div className="hero-copy"><span className="eyebrow"><Zap size={14}/> O futuro é elétrico</span><h1>Seu próximo carro<br/><em>é elétrico.</em></h1><p>Encontre, compare e negocie veículos elétricos diretamente com os anunciantes.</p></div></section>
      <section className="top-ad" aria-label="Espaço publicitário superior"><span className="ad-label">PUBLICIDADE</span><div><strong>SEU ANÚNCIO AQUI</strong><small>Espaço para banner publicitário horizontal</small></div></section>
      <section className="search-panel"><div className="search-input-wrap"><Search size={21}/><input value={search} onChange={e => doSearch(e.target.value)} placeholder="Busque por marca, modelo, preço ou qualquer característica..." /></div><button className="search-button" onClick={() => setPage(1)}>Buscar</button></section>
      <div className="content-layout">
        <aside className="side-ad"><span>PUBLICIDADE</span><strong>SEU<br/>ANÚNCIO<br/>AQUI</strong><small>Banner vertical</small></aside>
        <section className="results">
          <div className="section-heading"><div><span className="eyebrow dark">VITRINE DE OPORTUNIDADES</span><h2>Carros elétricos à venda</h2></div><span className="result-count">{filtered.length} anúncios</span></div>
          <div className="demo-note">Modo sem e-mails: cadastro e login ficam neste navegador; anúncios e fotos são armazenados no Firebase e ficam disponíveis para todos os visitantes. Propostas são apenas demonstrativas e não são enviadas.</div>
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
        {firebaseUser?.uid === selected.ownerUid && <button className="delete-button" onClick={() => removeListing(selected)}><Trash2 size={16}/> Excluir anúncio</button>}
        <div className="proposal-box"><h3>Gostou deste veículo?</h3><p>Registre uma proposta de demonstração. Ela ficará salva apenas neste navegador e não será enviada por e-mail.</p><input type="email" value={proposalEmail} onChange={e => setProposalEmail(e.target.value)} placeholder="Seu e-mail de contato"/><textarea value={proposal} onChange={e => setProposal(e.target.value)} placeholder="Escreva sua mensagem ou proposta..." rows="4"/><button className="primary full" disabled={busy} onClick={sendProposal}><Mail size={17}/> Registrar proposta (demonstração)</button></div>
      </div>
    </section></div>}

    {modal && <div className="overlay" onClick={() => setModal('')}><section className="form-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setModal('')}><X/></button>
      {modal === 'auth' && <><span className="eyebrow dark">BEM-VINDO AO SÓ ELÉTRICOS</span><h2>Entre ou crie sua conta</h2><p className="form-help">Conta demonstrativa salva somente neste navegador. Não há confirmação por e-mail.</p><label>E-mail</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@email.com"/><label>Senha</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres"/><button className="primary full" disabled={busy} onClick={login}>Entrar</button><button className="secondary full" disabled={busy} onClick={register}>Criar conta</button></>}
      {modal === 'publish' && <><span className="eyebrow dark">ANUNCIE GRÁTIS</span><h2>Cadastre seu veículo</h2><p className="form-help">Até 6 fotos. As imagens e os dados do anúncio serão armazenados no Firebase.</p><label>Fotos (máximo 6)</label><label className="upload-area"><Upload/><span>Escolher fotos do veículo</span><input type="file" accept="image/*" multiple onChange={e => setPhotos(Array.from(e.target.files || []).slice(0,6))}/></label><small className="file-list">{photos.map(f => f.name).join(' • ') || 'Nenhuma foto selecionada'}</small><label>Título do anúncio</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: BYD Dolphin Plus 2025"/><label>Descrição</label><textarea value={description} onChange={e => setDescription(e.target.value)} rows="5" placeholder="Descreva o veículo, ano, quilometragem, autonomia, estado de conservação..."/><button className="primary full" disabled={busy} onClick={publish}>{busy ? 'Salvando...' : 'Publicar anúncio'}</button></>}
    </section></div>}
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')}><X size={16}/></button></div>}
  </div>
}

export default App
