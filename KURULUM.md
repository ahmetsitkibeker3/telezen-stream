# teleZEN → Render → Zendex

Bu servis verdiğin GitHub HLS adresini kaynak olarak kullanır. Kick kanal sayfasından otomatik yayın URL'si çıkarmaz. GitHub dosyasını güncelleyen sistem çalışmaya devam etmelidir; dosya eski veya yayın kapalıysa Render yayını düzeltemez. Doğrudan güncel bir HLS adresin varsa SOURCE_M3U8 değerini onunla değiştirebilirsin.

## Render kurulumu (bilgisayar açık kalmaz)
1. ZIP'i aç. GitHub'da yeni bir depo oluştur; telezen-stream klasörünün içindeki dosyaları deponun köküne yükle. ZIP dosyasını olduğu gibi yükleme.
2. Render'da New → Web Service seç ve GitHub deponu bağla.
3. Name: telezen-stream, Language/Runtime: Node, Root Directory: boş (dosyalar deponun kökündeyse).
4. Build Command: npm install
5. Start Command: npm start
6. Environment bölümüne SOURCE_M3U8 ekle; değer olarak verdiğin GitHub m3u8 adresini gir. NODE_VERSION=22 ekle. PROXY_SECRET için uzun rastgele bir değer belirle; gizli tut ve değiştirme (değiştirmek mevcut alt bağlantıları geçersiz kılar).
7. Health Check Path: /health. Paket seç ve Deploy Web Service'e bas. Kesintisiz kullanım için uyumayan bir paket seç; güncel ücret ve trafik limitini Render panelinde kontrol et.
8. Render'ın verdiği gerçek servis adresini kullan: https://SENIN-SERVISIN.onrender.com/telezen.m3u8
9. Zendex'teki mevcut hls.js oynatıcıda kaynak adresini bu adresle değiştir. Örneğin hls.loadSource('https://SENIN-SERVISIN.onrender.com/telezen.m3u8');. Mevcut video elementine attachMedia işlemi aynı kalır.

Alternatif: Render'da New → Blueprint ile render.yaml dosyasını kullan. YAML starter paketini seçer; ücretli kaynak oluşturmadan önce panelde tutarı kontrol et.

## Ne yapıyor?
Alt playlist, segment ve URI="..." biçimindeki anahtar/başlatma dosyası adreslerini servise bağlar. Göreli adresleri upstream'in yönlendirme sonrası son URL'sine göre çözer. CORS ve Range isteklerini destekler. Segmentler RAM'de bütünüyle biriktirilmeden aktarılır; FFmpeg ve yeniden kodlama yoktur. /stream.m3u8 de aynı yayını açar.

Video trafiğinin tamamı Render üzerinden geçer. CPU yükü düşük olsa da trafik tüketimi izleyici sayısıyla büyür: 4 Mbps yayın tek izleyicide yaklaşık 1,8 GB/saat eder. 0,5 CPU / 512 MB ile küçük ölçekte başlayabilirsin; kapasite garantisi değildir.

## Yerel deneme
Node.js 22 veya daha yenisiyle:

    npm install
    npm test
    npm start

Tarayıcı/oynatıcı adresi: http://localhost:3000/telezen.m3u8
.env.example yalnızca örnektir; otomatik okunmaz. İstersen .env adıyla kopyalayıp node --env-file=.env server.js komutunu kullan.

## Sorun giderme
- /health yanıtı servisin çalıştığını gösterir; yayının çevrimiçi olduğunu göstermez.
- 502: kaynak HLS değil, bağlantı zaman aşımına uğradı veya kaynak erişilemiyor.
- 403: alt bağlantının imzası yanlış/eski; oynatıcıyı yeniden yükle. Kaynağın kendisi 403 döndürüyorsa Render'dan kaynak erişimi engelleniyor olabilir.
- 404: kaynak playlist/segment kaldırılmış olabilir.
- Ücretsiz servis uykuya girdiyse ilk açılış gecikebilir.
- DRM/erişim engeli aşma veya otomatik Kick çözümleme içermez.

Doğrulama: yerel sahte HLS kaynağı ile master→alt playlist→segment, key/map adresleri, CORS, Range ve imza kontrolleri test edilmiştir. Gerçek Kick/GitHub yayını ve Render üzerinde canlı dağıtım bu paketin hazırlanması sırasında test edilmemiştir.

Resmî Render belgeleri:
https://render.com/docs/deploy-node-express-app
https://render.com/docs/web-services
