import os, subprocess, sys
R='/Users/dheerajsharma/Desktop/personal/stubwise/app-store-assets/raw/'
OUT='/Users/dheerajsharma/Desktop/personal/stubwise/app-store-assets/'
HERE=os.path.dirname(os.path.abspath(__file__))
CHROME='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

CSS='''
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:%(W)dpx;height:%(H)dpx;overflow:hidden}
body{font-family:-apple-system,"SF Pro Display","Helvetica Neue",Arial,sans-serif;color:#17171C;-webkit-font-smoothing:antialiased;
 background:%(BG)s;position:relative}
.blob{position:absolute;border-radius:50%%;filter:blur(2px)}
h1{font-weight:800;letter-spacing:-0.035em;line-height:1.02}
h1 em{font-style:normal;color:#D6336C}
p.sub{color:#4C4C57;font-weight:500;letter-spacing:-0.01em}
.dev{position:absolute;background:#0E0E11;box-shadow:0 60px 140px rgba(120,30,70,.28),0 20px 50px rgba(20,20,40,.25);overflow:hidden}
.dev img{display:block;width:100%%;height:auto}
'''
GRADS={
 'pink':'linear-gradient(160deg,#FFE9F1 0%,#FFD3E3 45%,#E3F1FC 100%)',
 'sky':'linear-gradient(160deg,#E6F4FD 0%,#CDE8FA 50%,#FFE4EE 100%)',
 'blush':'linear-gradient(160deg,#FFF1F6 0%,#FFDCE8 55%,#DDEFFB 100%)',
}
def page(name,W,H,bg,body):
    html='<!doctype html><meta charset="utf-8"><style>'+CSS%{'W':W,'H':H,'BG':GRADS[bg]}+'</style><body>'+body+'</body>'
    p=os.path.join(HERE,name+'.html'); open(p,'w').write(html)
    out=os.path.join(OUT,name+'.png')
    subprocess.run([CHROME,'--headless=new','--disable-gpu','--hide-scrollbars','--force-device-scale-factor=1',f'--window-size={W},{H}','--default-background-color=FFFFFFFF',f'--screenshot={out}','file://'+p],check=True,capture_output=True)
    return out

def phone_shot(name,W,H,bg,title,sub,img):
    pw=1040; ph=int(pw*2868/1320)
    body=f'''
<div class="blob" style="left:-260px;top:1500px;width:900px;height:900px;background:radial-gradient(circle,rgba(214,51,108,.18),transparent 70%)"></div>
<div class="blob" style="right:-300px;top:-200px;width:1000px;height:1000px;background:radial-gradient(circle,rgba(15,143,191,.16),transparent 70%)"></div>
<div style="position:absolute;left:110px;right:110px;top:150px">
 <h1 style="font-size:132px">{title}</h1>
 <p class="sub" style="font-size:54px;margin-top:34px;line-height:1.25">{sub}</p>
</div>
<div class="dev" style="left:{(W-pw-44)//2}px;top:760px;width:{pw+44}px;height:{ph+44}px;border-radius:150px;padding:22px">
 <div style="border-radius:128px;overflow:hidden"><img src="{R}{img}"></div>
</div>'''
    return page(name,W,H,bg,body)

def ipad_shot(name,W,H,bg,title,sub,img,crop=None):
    pw=1740; ph=int(pw*2752/2064)
    top=650
    if crop:
        ph=crop; top=740
    body=f'''
<div class="blob" style="left:-300px;top:1600px;width:1000px;height:1000px;background:radial-gradient(circle,rgba(214,51,108,.16),transparent 70%)"></div>
<div class="blob" style="right:-300px;top:-260px;width:1100px;height:1100px;background:radial-gradient(circle,rgba(15,143,191,.16),transparent 70%)"></div>
<div style="position:absolute;left:150px;right:150px;top:130px;text-align:center">
 <h1 style="font-size:138px">{title}</h1>
 <p class="sub" style="font-size:58px;margin-top:30px">{sub}</p>
</div>
<div class="dev" style="left:{(W-pw-56)//2}px;top:{top}px;width:{pw+56}px;height:{ph+56}px;border-radius:84px;padding:28px">
 <div style="border-radius:58px;overflow:hidden;height:{ph}px"><img src="{R}{img}"></div>
</div>'''
    return page(name,W,H,bg,body)

def header(W=3840,H=1646):
    body=f'''
<div class="blob" style="left:-300px;top:-300px;width:1400px;height:1400px;background:radial-gradient(circle,rgba(214,51,108,.20),transparent 70%)"></div>
<div class="blob" style="right:-200px;bottom:-500px;width:1800px;height:1800px;background:radial-gradient(circle,rgba(15,143,191,.20),transparent 70%)"></div>
<div style="position:absolute;left:230px;top:300px;width:1450px">
 <div style="display:flex;align-items:center;gap:44px"><img src="{HERE}/icon.png" style="width:210px;height:210px;border-radius:48px;box-shadow:0 30px 70px rgba(120,30,70,.28)">
 <div style="font-size:150px;font-weight:800;letter-spacing:-0.04em">CrewStub</div></div>
 <h1 style="font-size:168px;margin-top:80px">Pay stubs for<br><em>small crews</em></h1>
 <p class="sub" style="font-size:68px;margin-top:46px;line-height:1.25">Taxes, year-to-date totals and clean PDFs, on iPhone and iPad.</p>
</div>
<div class="dev" style="left:2180px;top:200px;width:1560px;height:2200px;border-radius:92px;padding:24px;transform:rotate(0deg)">
 <div style="border-radius:70px;overflow:hidden"><img src="{R}ipad-stub.png"></div>
</div>
<div class="dev" style="left:1900px;top:420px;width:640px;height:1400px;border-radius:96px;padding:16px">
 <div style="border-radius:82px;overflow:hidden"><img src="{R}iphone-home.png"></div>
</div>'''
    return page('header-3840x1646',W,H,'sky',body)

def search(W=3840,H=2560):
    body=f'''
<div class="blob" style="left:-400px;bottom:-600px;width:1800px;height:1800px;background:radial-gradient(circle,rgba(214,51,108,.20),transparent 70%)"></div>
<div class="blob" style="right:-300px;top:-400px;width:1600px;height:1600px;background:radial-gradient(circle,rgba(15,143,191,.20),transparent 70%)"></div>
<div style="position:absolute;left:240px;top:520px;width:1640px">
 <img src="{HERE}/icon.png" style="width:230px;height:230px;border-radius:54px;box-shadow:0 30px 70px rgba(120,30,70,.28)">
 <h1 style="font-size:206px;margin-top:66px">Pay stubs,<br><em>done in a minute</em></h1>
 <p class="sub" style="font-size:72px;margin-top:52px;line-height:1.25">Taxes worked out, year-to-date totals kept, a clean PDF for every worker.</p>
</div>
<div class="dev" style="left:2290px;top:300px;width:1480px;border-radius:100px;padding:26px">
 <div style="border-radius:76px;overflow:hidden"><img src="{R}ipad-stub.png"></div>
</div>
<div class="dev" style="left:1990px;top:740px;width:760px;border-radius:112px;padding:16px">
 <div style="border-radius:96px;overflow:hidden"><img src="{R}iphone-home.png"></div>
</div>'''
    return page('search-3840x2560',W,H,'blush',body)

outs=[]
iph=[('home','pink','Pay stubs, <em>done in a minute</em>','See your next pay day and make a stub in one tap.','iphone-home.png'),
('stub','sky','Withholding <em>worked out</em> for you','Federal and state taxes on every stub.','iphone-stub.png'),
('insights','blush','See <em>where the money</em> goes','Net pay by month, quarter and worker.','iphone-insights.png'),
('workers','sky','Your <em>whole crew</em> in one place','Employees and 1099 contractors, every stub on file.','iphone-workers.png'),
('reports','pink','Reports and <em>year-end</em> totals','Earnings, deductions and W-2 or 1099-NEC numbers.','iphone-reports.png')]
for i,(n,bg,t,s,img) in enumerate(iph,1):
    outs.append(phone_shot(f'iphone-{i}-{n}',1320,2868,bg,t,s,img))
ipd=[('stub','sky','Edit on the left, <em>see the PDF</em> on the right','Every change shows up in the stub right away.','ipad-stub.png'),
('workers','pink','Your <em>whole crew</em> on one screen','Stubs due, stubs done and each worker\'s history.','ipad-workers.png'),
('insights','blush','See <em>where the money</em> goes','Net pay by month, quarter and worker.','ipad-insights.png',1220),
('home','sky','Pay stubs, <em>done in a minute</em>','Your next pay day and every recent stub.','ipad-home.png',1080)]
for i,row in enumerate(ipd,1):
    n,bg,t,s,img=row[:5]
    outs.append(ipad_shot(f'ipad-{i}-{n}',2064,2752,bg,t,s,img,row[5] if len(row)>5 else None))
outs.append(header()); outs.append(search())
print('\n'.join(outs))
