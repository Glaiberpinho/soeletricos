import { useEffect, useMemo, useState } from 'react'
import {
  Search, CarFront, Plus, UserRound, LogOut, ChevronLeft, ChevronRight,
  X, Mail, Upload, Zap, MapPin, Trash2, ArrowLeft, Pencil, ImagePlus
} from 'lucide-react'
import { auth, db, firebaseReady } from './firebase'
import { signInAnonymously, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { addDoc, collection, getDocs, query, orderBy, serverTimestamp, deleteDoc, doc, setDoc, updateDoc } from 'firebase/firestore'

const PAGE_SIZE = 18
const ADMIN_UID = 'y97qT8VFbbRcf2UFXy69tj8hSnH2'
// Data de transição: anúncios antigos não são apagados, apenas ocultados da vitrine.
const NEW_LISTINGS_FROM = new Date('2026-11-14T00:00:00-03:00').getTime()

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

function formatCurrency(value) {
  const amount = Number(value)
  return Number.isFinite(amount) && amount > 0
    ? amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
    : 'Consulte o valor'
}

// Localização aproximada por IP: não solicita GPS ou permissão do navegador.
// Se o provedor falhar ou retornar uma cidade incerta, mantém os espaços vazios.
function normalizePlace(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim()
}

function CampaignSlot({ campaigns, position }) {
  const options = campaigns.filter(c => c.position === position)
  const [index, setIndex] = useState(0)
  useEffect(() => { setIndex(0) }, [campaigns, position])
  useEffect(() => {
    if (options.length < 2) return
    const timer = setInterval(() => setIndex(i => (i + 1) % options.length), 8000)
    return () => clearInterval(timer)
  }, [options.length, position])
  const campaign = options[index % Math.max(1, options.length)]
  const horizontal = position === 'horizontal'
  if (!campaign) return horizontal
    ? <section className="top-ad" aria-label="Espaço publicitário superior"><span className="ad-label">PUBLICIDADE</span><div><strong>SEU ANÚNCIO AQUI</strong><small>Espaço para banner publicitário horizontal</small></div></section>
    : <aside className="side-ad"><span>PUBLICIDADE</span><strong>SEU<br/>ANÚNCIO<br/>AQUI</strong><small>Banner vertical</small></aside>
  return horizontal
    ? <section className="top-ad campaign-ad" aria-label="Publicidade local"><span className="ad-label">PUBLICIDADE</span><a href={campaign.destinationUrl} target="_blank" rel="noopener noreferrer sponsored" aria-label={`Abrir publicidade de ${campaign.name}`}><picture style={{ display: 'block', width: '100%', height: '100%' }}>{campaign.mobileImageUrl && <source media="(max-width: 760px)" srcSet={campaign.mobileImageUrl} />}<img src={campaign.imageUrl} alt={campaign.name} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} /></picture></a></section>
    : <aside className="side-ad campaign-ad" aria-label="Publicidade local"><span className="ad-label">PUBLICIDADE</span><a href={campaign.destinationUrl} target="_blank" rel="noopener noreferrer sponsored" aria-label={`Abrir publicidade de ${campaign.name}`}><img src={campaign.imageUrl} alt={campaign.name}/></a></aside>
}

function AdCard({ item, onOpen }) {
  return <button className="ad-card" onClick={() => onOpen(item)}>
    <div className="ad-photo">
      <img src={item.photoUrls?.[0] || 'https://placehold.co/600x400/eaf1ed/426354?text=Foto+do+veiculo'} alt={item.title} />
      <span className="electric-tag"><Zap size={12}/> {item.vehicleType === 'hybrid' ? 'Híbrido' : 'Elétrico'}</span>
    </div>
    <div className="ad-info">
      <h3>{item.title}</h3>
      <strong>{item.price ? formatCurrency(item.price) : 'Consulte o valor'}</strong>
      <small><MapPin size={13}/> {item.city ? `${item.city}${item.state ? ` - ${item.state}` : ''}` : 'Contato direto com o anunciante'}</small>
    </div>
  </button>
}

function App() {
  const [user, setUser] = useState(null)
  const [firebaseUser, setFirebaseUser] = useState(null)
  const [authLoaded, setAuthLoaded] = useState(false)
  const isAdmin = firebaseUser?.uid === ADMIN_UID
  const [listings, setListings] = useState([])
  const [visitorPlace, setVisitorPlace] = useState(null)
  const [campaigns, setCampaigns] = useState([])
  const [campaignName, setCampaignName] = useState('')
  const [campaignCity, setCampaignCity] = useState('')
  const [campaignState, setCampaignState] = useState('')
  const [campaignPosition, setCampaignPosition] = useState('horizontal')
  const [campaignImage, setCampaignImage] = useState('')
  const [campaignMobileImage, setCampaignMobileImage] = useState('')
  const [campaignUrl, setCampaignUrl] = useState('')
  const [campaignStart, setCampaignStart] = useState('')
  const [campaignEnd, setCampaignEnd] = useState('')
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
  const [price, setPrice] = useState('')
  const [editingListing, setEditingListing] = useState(null)
  const [vehicleType, setVehicleType] = useState('electric')
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0)
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
      setUser(current && !current.isAnonymous ? { uid: current.uid, email: current.email } : null)
      setAuthLoaded(true)
      if (!current) signInAnonymously(auth).catch(error => {
        console.error(error)
        setNotice('Não foi possível conectar ao Firebase. Verifique se o login anônimo está ativado.')
      })
    })
    loadListings()
    return unsubscribe
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 6000)
    // Provedor externo recebe o IP da conexão; não acessamos GPS.
    fetch('https://ipwho.is/', { signal: controller.signal })
      .then(r => { if (!r.ok) throw new Error('Localização indisponível'); return r.json() })
      .then(data => {
        if (data.country_code !== 'BR' || !data.city || !data.region_code || data.error) return
        setVisitorPlace({ city: data.city, state: data.region_code })
      })
      .catch(() => {})
      .finally(() => clearTimeout(timeout))
    return () => { clearTimeout(timeout); controller.abort() }
  }, [])

  useEffect(() => {
    if (!firebaseReady) return
    getDocs(collection(db, 'campaigns'))
      .then(snapshot => setCampaigns(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(error => console.warn('Publicidade indisponível:', error))
  }, [])

  const localCampaigns = useMemo(() => {
    if (!visitorPlace) return []
    const now = Date.now()
    return campaigns.filter(c => c.active === true
      && normalizePlace(c.city) === normalizePlace(visitorPlace.city)
      && normalizePlace(c.state) === normalizePlace(visitorPlace.state)
      && (!c.startDate || new Date(c.startDate + 'T00:00:00').getTime() <= now)
      && (!c.endDate || new Date(c.endDate + 'T23:59:59').getTime() >= now))
  }, [campaigns, visitorPlace])

  async function saveCampaign() {
    if (!isAdmin) return
    const name = campaignName.trim(), city = campaignCity.trim(), state = campaignState.trim().toUpperCase()
    let imageUrl, destinationUrl, mobileImageUrl
    try {
      imageUrl = new URL(campaignImage.trim())
      destinationUrl = new URL(campaignUrl.trim())
      if (imageUrl.protocol !== 'https:' || destinationUrl.protocol !== 'https:') throw Error('HTTPS obrigatório')
      if (campaignMobileImage.trim()) {
        mobileImageUrl = new URL(campaignMobileImage.trim())
        if (mobileImageUrl.protocol !== 'https:') throw Error('HTTPS obrigatório')
      }
    } catch { return setNotice('Informe links HTTPS válidos para a imagem/GIF e o destino.') }
    if (!name || !city || !/^[A-Z]{2}$/.test(state)) return setNotice('Informe anunciante, cidade e UF com duas letras.')
    if (campaignStart && campaignEnd && campaignEnd < campaignStart) return setNotice('A data final não pode ser anterior à inicial.')
    setBusy(true)
    try {
      const data = { name, city, state, position: campaignPosition, imageUrl: imageUrl.href,
        ...(mobileImageUrl ? { mobileImageUrl: mobileImageUrl.href } : {}),
        destinationUrl: destinationUrl.href, startDate: campaignStart, endDate: campaignEnd,
        active: true, createdBy: firebaseUser.uid, createdAt: serverTimestamp() }
      const ref = await addDoc(collection(db, 'campaigns'), data)
      setCampaigns(old => [...old, { ...data, id: ref.id }])
      setCampaignName(''); setCampaignCity(''); setCampaignState(''); setCampaignImage(''); setCampaignMobileImage(''); setCampaignUrl('')
      setCampaignStart(''); setCampaignEnd('')
      setNotice('Campanha cadastrada no Firebase.')
    } catch (error) { console.error(error); setNotice('Não foi possível salvar a publicidade. Confira as regras de campaigns no Firestore.') }
    finally { setBusy(false) }
  }

  async function changeCampaign(c, active) {
    if (!isAdmin) return
    try {
      if (active === null) {
        if (!confirm('Excluir esta publicidade?')) return
        await deleteDoc(doc(db, 'campaigns', c.id))
        setCampaigns(old => old.filter(x => x.id !== c.id))
      } else {
        await updateDoc(doc(db, 'campaigns', c.id), { active })
        setCampaigns(old => old.map(x => x.id === c.id ? { ...x, active } : x))
      }
    } catch (error) { console.error(error); setNotice('Não foi possível atualizar a publicidade.') }
  }

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
      .then(data => {
        setCitiesList(data)
        if (editingListing?.state === uf && editingListing?.city) setCity(editingListing.city)
      })
      .catch(error => { console.error(error); setCitiesList([]); setNotice('Não foi possível carregar os municípios. Tente selecionar o estado novamente.') })
      .finally(() => setCitiesLoading(false))
  }, [uf])

  async function loadListings() {
    if (!firebaseReady) return
    try {
      const q = query(collection(db, 'listings'), orderBy('createdAt', 'desc'))
      const snap = await getDocs(q)
      const remote = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      // Preserve todos os anúncios na memória para que o proprietário
      // encontre os seus independentemente do filtro da vitrine.
      setListings(remote)
    } catch (error) {
      console.error(error)
      setNotice('Não foi possível carregar os anúncios do Firebase. Verifique as regras do Firestore.')
    }
  }

  const filtered = useMemo(() => {
    // Pesquisa tolerante a acentos e espaços (ex.: 'Sao Paulo' encontra 'São Paulo').
    const normalize = value => String(value ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR')
      .replace(/\s+/g, ' ')
      .trim()
    const term = normalize(search)
    // A data de transição afeta apenas a vitrine pública.
    // Nunca ocultar anúncios do painel do proprietário ou administrador.
    const publicListings = listings.filter(item => {
      const time = item.createdAt?.toMillis?.() ?? 0
      return time >= NEW_LISTINGS_FROM
    })
    if (!term) return publicListings
    return publicListings.filter(item => normalize([
      item.title, item.description, item.price, item.city, item.state
    ].filter(value => value !== null && value !== undefined).join(' ')).includes(term))
  }, [listings, search])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const shown = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function doSearch(value) { setSearch(value); setPage(1) }

  async function register() {
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) return setNotice('Informe um e-mail válido.')
    if (password.length < 6) return setNotice('A senha precisa ter pelo menos 6 caracteres.')
    setBusy(true)
    try {
      await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password)
      setModal(''); setEmail(''); setPassword('')
      setNotice('Conta criada no Firebase! Seus anúncios estarão disponíveis em qualquer navegador.')
    } catch (error) {
      console.error(error)
      setNotice(error.code === 'auth/email-already-in-use' ? 'Este e-mail já está cadastrado. Faça login.' : `Não foi possível criar a conta: ${error.message}`)
    } finally { setBusy(false) }
  }

  async function login() {
    if (!email.trim() || !password) return setNotice('Informe seu e-mail e sua senha.')
    setBusy(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password)
      setModal(''); setEmail(''); setPassword('')
      setNotice('Login realizado! Seus anúncios estão vinculados à sua conta Firebase.')
    } catch (error) {
      console.error(error)
      setNotice('Não foi possível entrar. Confira o e-mail e a senha da conta Firebase.')
    } finally { setBusy(false) }
  }

  async function logout() {
    try { await signOut(auth); setNotice('Você saiu da sua conta.') }
    catch (error) { setNotice(`Não foi possível sair: ${error.message}`) }
  }

  async function publish() {
    if (!user || !firebaseUser || firebaseUser.isAnonymous) return setNotice('Entre ou crie uma conta com e-mail e senha para publicar anúncios.')
    if (!firebaseReady) return setNotice('Firebase não configurado. Não é possível publicar anúncios na nuvem.')
    if (!title.trim() || !description.trim()) return setNotice('Preencha o título e a descrição.')
    const numericPrice = Number(String(price).replace(/\./g, '').replace(',', '.'))
    if (!price.trim() || !Number.isFinite(numericPrice) || numericPrice <= 0) return setNotice('Informe um valor válido para o veículo.')
    if (!uf || !city) return setNotice('Selecione o estado e a cidade do veículo.')
    if (photos.length > 4) return setNotice('Você pode enviar no máximo 4 fotos.')
    if (description.trim().length > 5000) return setNotice('A descrição deve ter no máximo 5.000 caracteres.')
    setBusy(true)
    try {
      const currentFirebaseUser = auth.currentUser
      if (!currentFirebaseUser || currentFirebaseUser.isAnonymous || currentFirebaseUser.uid !== user.uid) throw new Error('Entre com e-mail e senha para publicar.')
      const photoUrls = []
      for (const photo of photos.filter(Boolean)) photoUrls.push(typeof photo === 'string' ? photo : await compressImage(photo))
      const totalPhotoBytes = photoUrls.reduce((total, photo) => total + photo.length, 0)
      if (totalPhotoBytes > 700 * 1024) throw new Error('As fotos ultrapassaram o limite seguro de 700 KB. Remova uma foto ou escolha imagens menores.')

      const listingRef = await addDoc(collection(db, 'listings'), {
        title: title.trim(),
        description: description.trim(),
        price: numericPrice,
        city,
        state: uf,
        photoUrls,
        vehicleType,
        ownerUid: currentFirebaseUser.uid,
        createdAt: serverTimestamp()
      })
      // O e-mail do anunciante fica em subcoleção privada, nunca no anúncio público.
      await setDoc(doc(db, 'listings', listingRef.id, 'private', 'contact'), {
        ownerEmail: user.email.trim().toLowerCase()
      })
      setTitle(''); setDescription(''); setPrice(''); setVehicleType('electric'); setPhotos([]); setPhotoPreviews([]); setUf(''); setCity(''); setModal(''); setPage(1)
      await loadListings()
      setNotice('Anúncio publicado! As fotos foram comprimidas e salvas no Firestore.')
    } catch (error) {
      console.error(error)
      setNotice(`Erro ao publicar: ${error?.message || 'verifique as configurações e regras do Firestore.'}`)
    } finally { setBusy(false) }
  }


  function openEditListing(item) {
    if (item.demo || item.ownerUid !== firebaseUser?.uid) return
    setEditingListing(item)
    setTitle(item.title || '')
    setDescription(item.description || '')
    setPrice(item.price != null ? String(item.price).replace('.', ',') : '')
    setVehicleType(item.vehicleType === 'hybrid' ? 'hybrid' : 'electric')
    setUf(item.state || '')
    setCity(item.city || '')
    const existingPhotos = Array.isArray(item.photoUrls) ? item.photoUrls.slice(0, 4) : []
    setPhotos(existingPhotos)
    setPhotoPreviews(existingPhotos)
    setSelected(null)
    setModal('edit')
  }

  async function saveListingChanges() {
    if (!editingListing || editingListing.ownerUid !== firebaseUser?.uid) return setNotice('Você não tem permissão para editar este anúncio.')
    if (!title.trim() || !description.trim()) return setNotice('Preencha o título e a descrição.')
    if (!uf || !city) return setNotice('Selecione o estado e a cidade do veículo.')
    const numericPrice = Number(String(price).replace(/\./g, '').replace(',', '.'))
    if (!price.trim() || !Number.isFinite(numericPrice) || numericPrice <= 0) return setNotice('Informe um valor válido para o veículo.')
    if (description.trim().length > 5000) return setNotice('A descrição deve ter no máximo 5.000 caracteres.')
    setBusy(true)
    try {
      const photoUrls = []
      for (const photo of photos.filter(Boolean)) photoUrls.push(typeof photo === 'string' ? photo : await compressImage(photo))
      const totalPhotoBytes = photoUrls.reduce((total, photo) => total + photo.length, 0)
      if (totalPhotoBytes > 700 * 1024) throw new Error('As fotos ultrapassaram o limite seguro de 700 KB. Remova uma foto ou escolha imagens menores.')
      await updateDoc(doc(db, 'listings', editingListing.id), {
        title: title.trim(),
        description: description.trim(),
        price: numericPrice,
        city,
        state: uf,
        photoUrls,
        vehicleType
      })
      await setDoc(doc(db, 'listings', editingListing.id, 'private', 'contact'), {
        ownerEmail: user.email.trim().toLowerCase()
      }, { merge: true })
      setEditingListing(null)
      setTitle(''); setDescription(''); setPrice(''); setVehicleType('electric'); setPhotos([]); setPhotoPreviews([]); setUf(''); setCity('')
      setModal('myListings')
      await loadListings()
      setNotice('Anúncio atualizado com sucesso!')
    } catch (error) {
      console.error(error)
      setNotice(`Não foi possível atualizar o anúncio: ${error?.message || 'verifique as regras do Firestore.'}`)
    } finally { setBusy(false) }
  }

  function addPhotoAt(index, file) {
    if (!file) return
    const nextPhotos = [...photos]
    const nextPreviews = [...photoPreviews]
    nextPhotos[index] = file
    setPhotos(nextPhotos)
    readFilePreview(file).then(preview => {
      nextPreviews[index] = preview
      setPhotoPreviews([...nextPreviews])
    }).catch(() => setNotice(`Não foi possível visualizar a foto ${index + 1}.`))
  }

  function removePhotoAt(index) {
    const nextPhotos = [...photos]
    const nextPreviews = [...photoPreviews]
    nextPhotos[index] = null
    nextPreviews[index] = null
    setPhotos(nextPhotos)
    setPhotoPreviews(nextPreviews)
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
    if (item.demo || (item.ownerUid !== firebaseUser?.uid && !isAdmin)) return
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
        {isAdmin && <button className="nav-link" onClick={() => { setSelected(null); setModal('adminListings') }}>Administrar anúncios</button>}
        {isAdmin && <button className="nav-link" onClick={() => { setSelected(null); setModal('campaigns') }}>Publicidade</button>}
        {user && <button className="nav-link" onClick={() => { setSelected(null); setModal('myListings') }}>Meus Anúncios</button>}
        {user ? <button className="nav-link" onClick={() => { setEditingListing(null); setTitle(''); setDescription(''); setPrice(''); setVehicleType('electric'); setPhotos([]); setPhotoPreviews([]); setUf(''); setCity(''); setModal('publish') }}><Plus size={16}/> Anunciar</button> : <button className="nav-link" onClick={() => setModal('auth')}><UserRound size={16}/> Entrar</button>}
        {user && <button className="nav-link muted" onClick={logout}><LogOut size={16}/> Sair</button>}
      </nav>
    </header>

    <main>
      <CampaignSlot campaigns={localCampaigns} position="horizontal"/>
      <section className="search-panel"><div className="search-input-wrap"><Search size={21}/><input value={search} onChange={e => doSearch(e.target.value)} placeholder="Busque por marca, modelo, preço ou qualquer característica..." /></div><button className="search-button" onClick={() => setPage(1)}>Buscar</button></section>
      <div className="content-layout">
        <CampaignSlot campaigns={localCampaigns} position="left"/>
        <section className="results">
          <div className="section-heading"><div><span className="eyebrow dark">VITRINE DE OPORTUNIDADES</span><h2>Carros elétricos à venda</h2></div><span className="result-count">{filtered.length} anúncios</span></div>
          {shown.length ? <div className="ad-grid">{shown.map(item => <AdCard key={item.id} item={item} onOpen={item => { setSelected(item); setSelectedPhotoIndex(0) }}/>)}</div> : <div className="empty"><CarFront size={36}/><h3>Nenhum anúncio encontrado</h3><p>Tente buscar por outra marca ou modelo.</p></div>}
          {pages > 1 && <div className="pagination"><button disabled={page === 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={18}/> Anterior</button><span>Página {page} de {pages}</span><button disabled={page === pages} onClick={() => setPage(p => p + 1)}>Próxima <ChevronRight size={18}/></button></div>}
        </section>
        <CampaignSlot campaigns={localCampaigns} position="right"/>
      </div>
    </main>

    <footer><div className="footer-brand">SÓ<span>ELÉTRICOS</span></div><p>Classificados de veículos elétricos. Negocie diretamente com o anunciante.</p><small>© {new Date().getFullYear()} Só Elétricos. Todos os direitos reservados.</small></footer>

    {selected && <div className="overlay" onClick={() => { setSelected(null); setSelectedPhotoIndex(0) }}><section className="detail-modal" onClick={e => e.stopPropagation()}>
      <button className="close" onClick={() => { setSelected(null); setSelectedPhotoIndex(0) }}><X/></button>
      <div className="detail-photos">{(() => { const gallery = selected.photoUrls?.length ? selected.photoUrls : ['https://placehold.co/900x600/eaf1ed/426354?text=Sem+foto']; const active = Math.min(selectedPhotoIndex, gallery.length - 1); return <><img className="detail-main-photo" src={gallery[active]} alt={`${selected.title} foto principal`} onClick={() => setSelectedPhotoIndex((active + 1) % gallery.length)}/><div className="detail-thumbnails">{gallery.map((src, i) => <button type="button" key={i} className={i === active ? 'active' : ''} onClick={() => setSelectedPhotoIndex(i)} aria-label={`Visualizar foto ${i + 1}`}><img src={src} alt={`${selected.title} miniatura ${i + 1}`}/></button>)}</div></> })()}</div>
      <div className="detail-content"><button className="back-link" onClick={() => { setSelected(null); setSelectedPhotoIndex(0) }}><ArrowLeft size={15}/> Voltar aos anúncios</button><span className="eyebrow dark">VEÍCULO ELÉTRICO</span><h2>{selected.title}</h2>{selected.price > 0 && <div className="detail-price">{formatCurrency(selected.price)}</div>}{selected.city && <p className="location"><MapPin size={14}/> {selected.city}{selected.state ? ` - ${selected.state}` : ''}</p>}<p className="description">{selected.description}</p>
        {(firebaseUser?.uid === selected.ownerUid || isAdmin) && <div className="owner-actions">{firebaseUser?.uid === selected.ownerUid && <button className="edit-button" onClick={() => openEditListing(selected)}><Pencil size={15}/> Editar anúncio</button>}<button className="delete-button" onClick={() => removeListing(selected)}><Trash2 size={16}/> Excluir anúncio</button></div>}
        <div className="proposal-box"><h3>Gostou deste veículo?</h3><p>Envie uma mensagem diretamente ao anunciante. Ela será encaminhada por e-mail.</p><input type="email" value={proposalEmail} onChange={e => setProposalEmail(e.target.value)} placeholder="Seu e-mail de contato"/><textarea value={proposal} onChange={e => setProposal(e.target.value)} placeholder="Escreva sua mensagem ou proposta..." rows="4"/><button className="primary full" disabled={busy} onClick={sendProposal}><Mail size={17}/> {busy ? 'Enviando...' : 'Enviar mensagem ao anunciante'}</button></div>
      </div>
    </section></div>}

    {modal && <div className="overlay" onClick={() => setModal('')}><section className="form-modal" onClick={e => e.stopPropagation()}><button className="close" onClick={() => setModal('')}><X/></button>
      {modal === 'campaigns' && isAdmin && <><span className="eyebrow dark">ADMINISTRAÇÃO</span><h2>Gerenciar publicidade local</h2><p className="form-help">Cadastre imagens ou GIFs hospedados em um endereço HTTPS público. A cidade é identificada aproximadamente pelo IP do visitante, sem solicitar GPS. A imagem deve estar publicada, por exemplo, na pasta public/banners do GitHub Pages.</p>
        <label>Anunciante</label><input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="Nome da empresa" maxLength={120}/>
        <div className="two-fields"><div><label>Cidade</label><input value={campaignCity} onChange={e => setCampaignCity(e.target.value)} placeholder="Belo Horizonte"/></div><div><label>UF</label><input value={campaignState} onChange={e => setCampaignState(e.target.value)} placeholder="MG" maxLength={2}/></div></div>
        <label>Espaço publicitário</label><select value={campaignPosition} onChange={e => setCampaignPosition(e.target.value)}><option value="horizontal">Horizontal superior</option><option value="left">Lateral esquerda</option><option value="right">Lateral direita</option></select>
        <label>Imagem ou GIF para computador (HTTPS)</label><input value={campaignImage} onChange={e => setCampaignImage(e.target.value)} placeholder="https://.../banners/empresa-pc.jpg"/>
        <label>Imagem ou GIF para celular (HTTPS, opcional)</label><input value={campaignMobileImage} onChange={e => setCampaignMobileImage(e.target.value)} placeholder="https://.../banners/empresa-celular.jpg"/>
        <label>Link HTTPS de destino</label><input value={campaignUrl} onChange={e => setCampaignUrl(e.target.value)} placeholder="https://www.anunciante.com.br"/>
        <div className="two-fields"><div><label>Início (opcional)</label><input type="date" value={campaignStart} onChange={e => setCampaignStart(e.target.value)}/></div><div><label>Fim (opcional)</label><input type="date" value={campaignEnd} onChange={e => setCampaignEnd(e.target.value)}/></div></div>
        <button className="primary full" disabled={busy} onClick={saveCampaign}>Cadastrar publicidade</button>
        <h3>Campanhas cadastradas</h3><div className="my-listings">{campaigns.map(c => <div className="my-listing-row" key={c.id}><div className="my-listing-info"><strong>{c.name}</strong><small>{c.city} - {c.state} · {c.position} · {c.active ? 'Ativa' : 'Pausada'}</small></div><button type="button" className="edit-button" onClick={() => changeCampaign(c, !c.active)}>{c.active ? 'Pausar' : 'Ativar'}</button><button type="button" className="delete-button" onClick={() => changeCampaign(c, null)}>Excluir</button></div>)}</div>
      </>}
      {modal === 'adminListings' && isAdmin && <><span className="eyebrow dark">ADMINISTRAÇÃO</span><h2>Todos os anúncios</h2><p className="form-help">Exclua anúncios de qualquer anunciante. Esta operação é permanente.</p><div className="my-listings">{listings.map(item => <div className="my-listing-row" key={item.id}><img src={item.photoUrls?.[0] || 'https://placehold.co/120x90/eaf1ed/426354?text=Sem+foto'} alt=""/><div className="my-listing-info"><strong>{item.title}</strong><small>{item.city || ''} - {item.state || ''}</small></div><button type="button" className="delete-button" onClick={() => removeListing(item)}><Trash2 size={14}/> Excluir</button></div>)}</div></>}
      {modal === 'myListings' && <><span className="eyebrow dark">SUA GARAGEM</span><h2>Meus Anúncios</h2><p className="form-help">Gerencie seus veículos publicados. Você pode editar todas as informações e trocar as fotos.</p><div className="my-listings">{listings.filter(item => !item.demo && item.ownerUid === firebaseUser?.uid).map(item => <div className="my-listing-row" key={item.id}><img src={item.photoUrls?.[0] || 'https://placehold.co/120x90/eaf1ed/426354?text=Sem+foto'} alt=""/><div className="my-listing-info"><strong>{item.title}</strong><small>{item.price ? formatCurrency(item.price) : 'Sem valor informado'}</small><small>{item.city || ''}{item.state ? ` - ${item.state}` : ''}</small></div><button type="button" className="edit-button" onClick={() => openEditListing(item)}><Pencil size={14}/> Editar</button></div>)}{!listings.some(item => !item.demo && item.ownerUid === firebaseUser?.uid) && <div className="empty compact"><CarFront size={30}/><h3>Você ainda não tem anúncios</h3><p>Seus veículos publicados aparecerão aqui.</p></div>}</div></>}
      {modal === 'auth' && <><span className="eyebrow dark">BEM-VINDO AO SÓ ELÉTRICOS</span><h2>Entre ou crie sua conta</h2><p className="form-help">Sua conta fica protegida pelo Firebase e funciona em qualquer navegador. Use a mesma senha em todos os dispositivos.</p><label>E-mail</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="voce@email.com"/><label>Senha</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres"/><button className="primary full" disabled={busy} onClick={login}>Entrar</button><button className="secondary full" disabled={busy} onClick={register}>Criar conta</button></>}
      {modal === 'publish' && <><span className="eyebrow dark">ANUNCIE GRÁTIS</span><h2>Cadastre seu veículo</h2><p className="form-help">Até 4 fotos, comprimidas automaticamente para economizar espaço. O limite total das imagens é de 700 KB por anúncio.</p><label>Fotos (até 4, anexadas individualmente)</label><div className="photo-slots">{[0,1,2,3].map(index => <div className="photo-slot" key={index}><label className="upload-area"><ImagePlus size={17}/><span>{photoPreviews[index] ? `Trocar foto ${index + 1}` : `Anexar foto ${index + 1}`}</span><input type="file" accept="image/*" onChange={e => { addPhotoAt(index, e.target.files?.[0]); e.target.value = '' }}/></label>{photoPreviews[index] && <div className="photo-preview"><img src={photoPreviews[index]} alt={`Prévia da foto ${index + 1}`}/><button type="button" onClick={() => removePhotoAt(index)} aria-label={`Remover foto ${index + 1}`}><X size={14}/></button></div>}</div>)}</div><small className="file-list">{photos.filter(Boolean).length} de 4 fotos selecionadas</small><div className="two-fields"><div><label>Estado</label><select value={uf} onChange={e => setUf(e.target.value)}><option value="">Selecione</option>{statesList.map(item => <option key={item.id} value={item.sigla}>{item.nome} ({item.sigla})</option>)}</select></div><div><label>Cidade</label><select value={city} onChange={e => setCity(e.target.value)} disabled={!uf || citiesLoading}><option value="">{citiesLoading ? 'Carregando...' : 'Selecione'}</option>{citiesList.map(item => <option key={item.id} value={item.nome}>{item.nome}</option>)}</select></div></div><label>Tipo de veículo</label><div className="two-fields" style={{marginBottom: 12}}><label style={{display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'}}><input type="radio" name="vehicleType" value="electric" checked={vehicleType === 'electric'} onChange={() => setVehicleType('electric')} style={{width: 'auto'}}/> Elétrico</label><label style={{display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'}}><input type="radio" name="vehicleType" value="hybrid" checked={vehicleType === 'hybrid'} onChange={() => setVehicleType('hybrid')} style={{width: 'auto'}}/> Híbrido</label></div><label>Título do anúncio</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: BYD Dolphin Plus 2025"/><label>Valor do veículo (R$)</label><input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="Ex.: 129.900,00"/><label>Descrição</label><textarea value={description} onChange={e => setDescription(e.target.value)} rows="5" placeholder="Descreva o veículo, ano, quilometragem, autonomia, estado de conservação..."/><button className="primary full" disabled={busy} onClick={publish}>{busy ? 'Salvando...' : 'Publicar anúncio'}</button></>}
      {modal === 'edit' && <><span className="eyebrow dark">ATUALIZE SEU ANÚNCIO</span><h2>Editar veículo</h2><p className="form-help">Altere os dados e substitua ou remova as fotos. As mudanças serão aplicadas ao anúncio publicado.</p><label>Fotos (até 4, anexadas individualmente)</label><div className="photo-slots">{[0,1,2,3].map(index => <div className="photo-slot" key={index}><label className="upload-area"><ImagePlus size={17}/><span>{photoPreviews[index] ? `Trocar foto ${index + 1}` : `Anexar foto ${index + 1}`}</span><input type="file" accept="image/*" onChange={e => { addPhotoAt(index, e.target.files?.[0]); e.target.value = '' }}/></label>{photoPreviews[index] && <div className="photo-preview"><img src={photoPreviews[index]} alt={`Prévia da foto ${index + 1}`}/><button type="button" onClick={() => removePhotoAt(index)} aria-label={`Remover foto ${index + 1}`}><X size={14}/></button></div>}</div>)}</div><small className="file-list">{photos.filter(Boolean).length} de 4 fotos selecionadas</small><div className="two-fields"><div><label>Estado</label><select value={uf} onChange={e => setUf(e.target.value)}><option value="">Selecione</option>{statesList.map(item => <option key={item.id} value={item.sigla}>{item.nome} ({item.sigla})</option>)}</select></div><div><label>Cidade</label><select value={city} onChange={e => setCity(e.target.value)} disabled={!uf || citiesLoading}><option value="">{citiesLoading ? 'Carregando...' : 'Selecione'}</option>{citiesList.map(item => <option key={item.id} value={item.nome}>{item.nome}</option>)}</select></div></div><label>Tipo de veículo</label><div className="two-fields" style={{marginBottom: 12}}><label style={{display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'}}><input type="radio" name="vehicleType" value="electric" checked={vehicleType === 'electric'} onChange={() => setVehicleType('electric')} style={{width: 'auto'}}/> Elétrico</label><label style={{display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer'}}><input type="radio" name="vehicleType" value="hybrid" checked={vehicleType === 'hybrid'} onChange={() => setVehicleType('hybrid')} style={{width: 'auto'}}/> Híbrido</label></div><label>Título do anúncio</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: BYD Dolphin Plus 2025"/><label>Valor do veículo (R$)</label><input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} placeholder="Ex.: 129.900,00"/><label>Descrição</label><textarea value={description} onChange={e => setDescription(e.target.value)} rows="5" placeholder="Descreva o veículo, ano, quilometragem, autonomia, estado de conservação..."/><button className="primary full" disabled={busy} onClick={saveListingChanges}>{busy ? 'Salvando...' : 'Salvar alterações'}</button></>}
    </section></div>}
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')}><X size={16}/></button></div>}
  </div>
}

export default App
