import { useEffect, useMemo, useState } from 'react'
import {
  Search, CarFront, Plus, UserRound, LogOut, ChevronLeft, ChevronRight,
  X, Mail, Upload, Zap, MapPin, Trash2, ArrowLeft
} from 'lucide-react'
import { demoListings } from './demo'
import { auth, db, firebaseReady } from './firebase'
import { signInAnonymously, onAuthStateChanged } from 'firebase/auth'
import { addDoc, collection, getDocs, query, orderBy, serverTimestamp, deleteDoc, doc, setDoc } from 'firebase/firestore'

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
function readFilePreview(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = reject
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(file)
  })
}

// Comprime a imagem no navegador para que as quatro fotos caibam com folga
// no limite de 1 MiB por documento do Firestore (plano Spark).
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error(`O arquivo ${file.name} não é uma imagem válida.`))
      img.onload = async () => {
        const canvas = document.createElement('canvas')
        const context = canvas.getContext('2d')
        if (!context) return reject(new Error('Seu navegador não conseguiu processar a imagem.'))
        let maxDimension = 960
        let quality = 0.72
        let dataUrl = ''
        for (let attempt = 0; attempt < 12; attempt++) {
          const scale = Math.min(1, maxDimension / Math.max(img.width, img.height))
          canvas.width = Math.max(1, Math.round(img.width * scale))
          canvas.height = Math.max(1, Math.round(img.height * scale))
          context.clearRect(0, 0, canvas.width, canvas.height)
          context.drawImage(img, 0, 0, canvas.width, canvas.height)
          dataUrl = canvas.toDataURL('image/jpeg', quality)
          if (dataUrl.length <= 140 * 1024) return resolve(dataUrl)
          if (quality > 0.42) quality -= 0.08
          else { maxDimension = Math.round(maxDimension * 0.82); quality = 0.62 }
        }
        if (dataUrl && dataUrl.length <= 170 * 1024) resolve(dataUrl)
        else reject(new Error(`A foto ${file.name} ficou muito grande mesmo após a compressão. Escolha outra imagem ou reduza sua resolução.`))
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
      <small><MapPin size={13}/> {item.city ? `${item.city}${item.state ? ` - ${item.state}` : ''}` : 'Contato direto com o anunciante'}</small>
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
  const [photoPreviews, setPhotoPreviews] = useState([])
  const [uf, setUf] = useState('')
  const [city, setCity] = useState('')
  const [statesList, setStatesList] = useState([])
  const [citiesList, setCitiesList] = useState([])
  const [citiesLoading, setCitiesLoading] = useState(false)
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

  useEffect(() => {
    fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome')
      .then(response => { if (!response.ok) throw new Error('Falha ao carregar estados'); return response.json() })
      .then(data => setStatesList(data))
      .catch(error => { console.error(error); setNotice('Não foi possível carregar a lista de estados. Verifique sua conexão e tente novamente.') })
  }, [])

  useEffect(() => {
    if (!uf) { setCitiesList([]); setCity(''); return }
    setCitiesLoading(true)
    setCity('')
    fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`)
      .then(response => { if (!response.ok) throw new Error('Falha ao carregar municípios'); return response.json() })
      .then(data => setCitiesList(data))
      .catch(error => { console.error(error); setCitiesList([]); setNotice('Não foi possível carregar os municípios. Tente selecionar o estado novamente.') })
      .finally(() => setCitiesLoading(false))
  }, [uf])

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
    return listings.filter(item => [item.title, item.description, item.price, item.city, item.state].filter(Boolean).join(' ').toLocaleLowerCase('pt-BR').includes(term))
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
    if (!uf || !city) return setNotice('Selecione o estado e a cidade do veículo.')
    if (photos.length > 4) return setNotice('Você pode enviar no máximo 4 fotos.')
    if (description.trim().length > 5000) return setNotice('A descrição deve ter no máximo 5.000 caracteres.')
    setBusy(true)
    try {
      let currentFirebaseUser = auth.currentUser
      if (!currentFirebaseUser) currentFirebaseUser = (await signInAnonymously(auth)).user
      const photoUrls = []
      for (const file of photos) photoUrls.push(await compressImage(file))
      const totalPhotoBytes = photoUrls.reduce((total, photo) => total + photo.length, 0)
      if (totalPhotoBytes > 700 * 1024) throw new Error('As fotos ultrapassaram o limite seguro de 700 KB. Remova uma foto ou escolha imagens menores.')

      const listingRef = await addDoc(collection(db, 'listings'), {
        title: title.trim(),
        description: description.trim(),
        city,
        state: uf,
        photoUrls,
        ownerUid: currentFirebaseUser.uid,
        createdAt: serverTimestamp()
      })
      // O e-mail do anunciante fica em subcoleção privada, nunca no anúncio público.
      await setDoc(doc(db, 'listings', listingRef.id, 'private', 'contact'), {
        ownerEmail: user.email.trim().toLowerCase()
      })
      setTitle(''); setDescription(''); setPhotos([]); setPhotoPreviews([]); setUf(''); setCity(''); setModal(''); setPage(1)
      await loadListings()
      setNotice('Anúncio publicado! As fotos foram comprimidas e salvas no Firestore.')
    } catch (error) {
      console.error(error)
      setNotice(`Erro ao publicar: ${error?.message || 'verifique as configurações e regras do Firestore.'}`)
    } finally { setBusy(false) }
  }


  async function sendProposal() {
    if (!proposal.trim() || !proposalEmail.trim()) return setNotice('Informe seu e-mail e escreva uma mensagem.')
    if (!/^\S+@\S+\.\S+$/.test(proposalEmail.trim())) return setNotice('Informe um e-mail válido.')
    if (proposal.trim().length < 5 || proposal.trim().length > 5000) return setNotice('A mensagem deve ter entre 5 e 5.000 caracteres.')
    if (selected?.demo) return setNotice('Este é um anúncio de demonstração. Escolha um anúncio publicado para enviar uma mensagem.')
    if (!firebaseReady) return setNotice('Não foi possível conectar ao serviço de mensagens.')
    setBusy(true)
    try {
      await addDoc(collection(db, 'proposals'), {
        listingId: selected.id,
        senderEmail: proposalEmail.trim().toLowerCase(),
        message: proposal.trim(),
        status: 'pending',
        createdAt: serverTimestamp()
      })
      setProposal(''); setProposalEmail('')
      setNotice('Mensagem registrada! O sistema enviará seu e-mail ao anunciante em alguns minutos.')
    } catch (error) {
      console.error(error)
      setNotice(`Não foi possível enviar a mensagem: ${error?.message || 'tente novamente.'}`)
    } finally { setBusy(false) }
  }

    async function removeListing(item) {
    if (item.demo || item.ownerUid !== firebaseUser?.uid) return
    if (!confirm('Excluir este anúncio?')) return
    try {
      await deleteDoc(doc(db, 'listings', item.id, 'private', 'contact')).catch(() => {})
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
          <div className="demo-note">Anúncios e fotos são armazenados no Firebase. Mensagens aos anunciantes são encaminhadas automaticamente por e-mail.</div>
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
      <div className="detail-content"><button className="back-link" onClick={() => setSelected(null)}><ArrowLeft size={15}/> Voltar aos anúncios</button><span className="eyebrow dark">VEÍCULO ELÉTRICO</span><h2>{selected.title}</h2>{selected.city && <p className="location"><MapPin size={14}/> {selected.city}{selected.state ? ` - ${selected.state}` : ''}</p>}<p className="description">{selected.description}</p>
        {firebaseUser?.uid === selected.ownerUid && <button className="delete-button" onClick={() => removeListing(selected)}><Trash2 size={16}/> Excluir anúncio</button>}
        <div className="proposal-box"><h3>Gostou deste veículo?</h3><p>Envie uma mensagem diretamente ao anunciante. Ela será encaminhada por e-mail.</p><input type="email" value={proposalEmail} onChange={e => setProposalEmail(e.target.value)} placeholder="Seu e-mail de contato"/><textarea value={proposal} onChange={e => setProposal(e.target.value)} placeholder="Escreva sua mensagem ou proposta..." rows="4"/><button className="primary full" disabled={busy} onClick={sendProposal}><Mail size={17}/> {busy ? 'Enviando...' : 'Enviar mensagem ao anunciante'}</button></div>
      </div>
    </section></div>}

    {modal && <div className="overlay" onClick={() => setModal('')}><section className="form-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setModal('')}><X/></button>
      {modal === 'auth' && <><span className="eyebrow dark">BEM-VINDO AO SÓ ELÉTRICOS</span><h2>Entre ou crie sua conta</h2><p className="form-help">Conta demonstrativa salva somente neste navegador. Não há confirmação por e-mail.</p><label>E-mail</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@email.com"/><label>Senha</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres"/><button className="primary full" disabled={busy} onClick={login}>Entrar</button><button className="secondary full" disabled={busy} onClick={register}>Criar conta</button></>}
      {modal === 'publish' && <><span className="eyebrow dark">ANUNCIE GRÁTIS</span><h2>Cadastre seu veículo</h2><p className="form-help">Até 4 fotos, comprimidas automaticamente para economizar espaço. O limite total das imagens é de 700 KB por anúncio.</p><label>Fotos (máximo 4)</label><label className="upload-area"><Upload/><span>Escolher fotos do veículo</span><input type="file" accept="image/*" multiple onChange={async e => { const files = Array.from(e.target.files || []); if (files.length > 4) setNotice('Selecione no máximo 4 fotos.'); const chosen = files.slice(0,4); setPhotos(chosen); try { setPhotoPreviews(await Promise.all(chosen.map(readFilePreview))) } catch { setPhotoPreviews([]); setNotice('Não foi possível visualizar uma das fotos.') } e.target.value = '' }}/></label><small className="file-list">{photos.length ? `${photos.length} de 4 fotos selecionadas` : 'Nenhuma foto selecionada'}</small>{photoPreviews.length > 0 && <div className="photo-preview-grid">{photoPreviews.map((src, index) => <div className="photo-preview" key={`${index}-${src.slice(-20)}`}><img src={src} alt={`Prévia da foto ${index + 1}`}/><button type="button" onClick={() => { setPhotos(current => current.filter((_, i) => i !== index)); setPhotoPreviews(current => current.filter((_, i) => i !== index)) }} aria-label={`Remover foto ${index + 1}`}><X size={14}/></button></div>)}</div>}<div className="two-fields"><div><label>Estado</label><select value={uf} onChange={e => setUf(e.target.value)}><option value="">Selecione</option>{statesList.map(item => <option key={item.id} value={item.sigla}>{item.nome} ({item.sigla})</option>)}</select></div><div><label>Cidade</label><select value={city} onChange={e => setCity(e.target.value)} disabled={!uf || citiesLoading}><option value="">{citiesLoading ? 'Carregando...' : 'Selecione'}</option>{citiesList.map(item => <option key={item.id} value={item.nome}>{item.nome}</option>)}</select></div></div><label>Título do anúncio</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: BYD Dolphin Plus 2025"/><label>Descrição</label><textarea value={description} onChange={e => setDescription(e.target.value)} rows="5" placeholder="Descreva o veículo, ano, quilometragem, autonomia, estado de conservação..."/><button className="primary full" disabled={busy} onClick={publish}>{busy ? 'Salvando...' : 'Publicar anúncio'}</button></>}
    </section></div>}
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')}><X size={16}/></button></div>}
  </div>
}

export default App
