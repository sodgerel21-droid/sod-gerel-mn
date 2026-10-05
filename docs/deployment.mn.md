# e-property.mn байршуулалт

## Бүтэц

- Nexus: `backend/v1.28.0`; Go module болон `core.lock` ижил хувилбартай.
- Backend/frontend: тухайн distribution commit SHA-тай GHCR образ.
- Серверийн үндсэн зам: `/opt/e-property-mn`.
- Release: `releases/<sha>`, амжилттай хувилбар: `current` symlink.
- Compose project: `e-property-mn`, өгөгдлийн volume бусад платформоос тусдаа.
- API: `127.0.0.1:8180`, web: `127.0.0.1:3180`.
- PostgreSQL/Redis гадагшаа порт нээхгүй.
- Operator console идэвхжүүлээгүй. Бодит eID, төрийн API credential оруулаагүй.

## Нэг удаагийн provision

1. Зорилтот Linux серверт Docker Engine + Compose plugin, nginx, certbot,
   `flock`, SSH суулгана. Сонгосон deploy хэрэглэгч Docker болон зөвхөн энэ
   төслийн замд хандах эрхтэй байна.
2. `/opt/e-property-mn` замыг deploy хэрэглэгч эзэмшинэ. `.env` нь `0600` эрхтэй,
   `deploy/.env.example`-ийн утгуудтай байна. POSTGRES_PASSWORD болон
   SSO_DEFAULT_CLIENT_SECRET-д тус бүр `openssl rand -hex 32`, хоёр encryption
   key-д тус бүр `openssl rand -base64 32` ашиглана. Нууцыг репод commit хийхгүй.
   `IMAGE_TAG`-ийг rollout скрипт тухайн SHA-аар дамжуулна.
   Нүүр хуудсыг nginx уншдаг `/var/www/e-property-mn` хавтсыг deploy хэрэглэгч
   эзэмшинэ: `install -d -o deploy -g deploy -m 755 /var/www/e-property-mn`.
3. DNS A/AAAA-ийг баталгаажсан серверт чиглүүлнэ. 80/443-ыг нээнэ.
   HTTP ACME webroot `/var/www/letsencrypt`-ийг nginx-ээр үйлчилж,
   `certbot certonly --webroot -w /var/www/letsencrypt -d e-property.mn` ажиллуулна.
   Сертификаттай бол `deploy/nginx.conf`-ийг суулгаж, `nginx -t` амжилттай
   болсны дараа reload хийнэ. ACME renewal timer идэвхтэйг шалгана.
   Операторын консол `admin.e-property.mn` дээр (мөн `-d admin.e-property.mn`
   сертификат). `nginx.conf` нь pipeline-аар шинэчлэгддэггүй: өөрчлөгдвөл гараар
   хуулж, `nginx -t` дараа reload хийнэ.
4. GitHub `production` environment-д зөвхөн `main` branch зөвшөөрнө.
   Environment secrets:
   - `DEPLOY_HOST`: серверийн IP/host
   - `DEPLOY_USER`: deploy хэрэглэгч
   - `DEPLOY_SSH_KEY`: энэ deploy-д зориулсан SSH private key
   - `DEPLOY_KNOWN_HOSTS`: серверийн host key-г итгэмжлэгдсэн сувгаар шалгасан
     known_hosts мөр. Pipeline дотор шууд ssh-keyscan-д итгэхгүй.
5. Repo secret `PRIVATE_NEXUS_TOKEN` нь private core уншихад хэрэглэгдэнэ.
   Боломжтой үед зөвхөн core contents:read эрхтэй dedicated token хэрэглэнэ.
6. Main CI ногоон болсны дараа `DEPLOY_ENABLED=true` variable тавьж,
   `Deploy e-property.mn` workflow ажиллуулна. Дараагийн main push бүр CI
   амжилттай дууссаны дараа автоматаар rollout хийнэ.

## Rollout ба буцаалт

Pipeline зөвхөн одоогийн main SHA, амжилттай push CI-тай release-ийг deploy хийнэ.
Сервер дээр lock авч, image татаж, DB backup хийгээд migration ажиллуулна.
Backend `/ready`, frontend healthcheck амжилттай болсны дараа `current` солино.
Апп healthcheck унавал өмнөх аппын образ руу буцаахыг оролдоно. Schema автоматаар
буцахгүй; upstream migration нь өмнөх хувилбартай нийцтэй эсэхийг release бүрд
нягтална. Migration өөрөө унавал rollout зогсоно, өмнөх аппыг хэвээр үлдээнэ.

Backup нь серверийн `/opt/e-property-mn/backups`-д байна. Серверээс тусдаа backup
storage, retention болон restore drill нь production ашиглалтын нэмэлт ажил.

## Шалгах

- `https://e-property.mn/`: 200, E-Property нэртэй статик нүүр хуудас (`landing/`)
- `https://e-property.mn/health`: 200
- `https://e-property.mn/ready`: 403 (зөвхөн дотоод шалгалт)
- `/api/platform/`: 403
- Нэвтрэлт, bootstrap урсгалыг бодит байгууллагын мэдээллээр туршина.
  Анхны tenant-д image доторх `/app/tenant-bootstrap` ашиглана;
  demo хэрэглэгчийг production-д үүсгэхгүй.
