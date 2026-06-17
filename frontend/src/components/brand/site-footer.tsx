import { Phone, MapPin, ExternalLink } from 'lucide-react';

/**
 * 现代风格页脚 — 优化排版与视觉层级
 *  - 更柔和的边框与背景融合
 *  - 增加信息图标，提升可读性
 *  - 联系方式 + 友情链接 + 版权信息重排版
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white px-4 py-8 sm:px-6 sm:py-12 md:px-10 md:py-20">
      <div className="mx-auto max-w-[1400px]">
        <div className="grid gap-8 sm:gap-10 md:gap-12 md:grid-cols-2 lg:grid-cols-12">
          {/* 学院信息 */}
          <div className="lg:col-span-4 lg:pr-8 flex flex-col items-center text-center sm:items-start sm:text-left">
            <div className="flex items-center gap-2 sm:gap-4">
              <img src="/wyu/logo-wuyi.png" alt="Wuyi University" className="h-7 sm:h-11 w-auto object-contain" draggable={false} />
              <div className="h-4 sm:h-8 w-px bg-slate-200"></div>
              <img src="/wyu/logo-iec.png" alt="School of International Education" className="h-7 sm:h-11 w-auto object-contain" draggable={false} />
            </div>
            <p className="mt-5 sm:mt-8 text-[11px] sm:text-xs leading-relaxed text-slate-500 max-w-[280px] sm:max-w-none text-justify indent-[2em]">
              国际教育学院成立于2023年11月，采用中外学分互认、学位联授的联合培养模式，与澳大利亚悉尼科技大学、麦考瑞大学、英国朴次茅斯大学、萨塞克斯大学等国外优质大学开展中外联合培养项目，围绕计算机科学与技术、通信工程、人工智能、英语、会计学、金融学、法学7个优势专业开展“2+2”双学士学位本科、“3+X”本硕连读项目。
            </p>
            <div className="mt-5 sm:mt-6 flex flex-col sm:flex-row items-center sm:items-start gap-2 sm:gap-3 text-[11px] sm:text-xs text-slate-500">
              <MapPin className="hidden sm:block mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
              <p className="leading-relaxed">
                广东省江门市蓬江区东成村 22 号<br className="hidden sm:block" /><span className="sm:hidden"> · </span>邮编：529020
              </p>
            </div>
          </div>

          {/* 招生咨询 */}
          <div className="lg:col-span-3 flex flex-col items-center">
            <h4 className="text-center text-sm font-semibold text-slate-900">
              中外联合培养项目咨询电话
            </h4>
            <ul className="mt-4 sm:mt-6 grid grid-cols-2 gap-y-4 gap-x-4 sm:gap-x-8 w-fit">
              {[
                { name: '陈老师', phone: '0750-3299032', mobile: '13760525830' },
                { name: '郜老师', phone: '0750-3296936', mobile: '18922002792' },
                { name: '徐老师', phone: '0750-3296937', mobile: '13428280859' },
                { name: '方老师', phone: '0750-3296381', mobile: '13979463917' },
              ].map((t, i) => (
                <li key={i} className="flex flex-col items-center sm:items-start text-center sm:text-left">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                      <Phone className="h-2.5 w-2.5" />
                    </div>
                    <span className="text-xs font-medium text-slate-700">{t.name}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 text-[11px] text-slate-500">
                    <a className="hover:text-[#004a8c] transition-colors" href={`tel:${t.phone}`}>{t.phone}</a>
                    <a className="hover:text-[#004a8c] transition-colors" href={`tel:${t.mobile}`}>{t.mobile}</a>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* 二维码合集 */}
          <div className="lg:col-span-3 flex flex-row justify-center sm:justify-start gap-4 sm:gap-8">
            {/* 官方公众号二维码 */}
            <div className="flex flex-col items-center">
              <h4 className="text-sm font-semibold text-slate-900">
                学院官方公众号
              </h4>
              <div className="mt-4 sm:mt-6 p-1.5 sm:p-2 bg-white border border-slate-100 rounded-xl shadow-sm">
                <img
                  src="/wyu/qr-mp.jpg"
                  alt="五邑大学国际教育学院官方公众号"
                  className="w-20 h-20 sm:w-28 sm:h-28 object-cover rounded-lg"
                />
              </div>
              <p className="mt-2 sm:mt-3 text-[10px] sm:text-[11px] text-slate-400 text-center w-full">
                扫码关注学院官方公众号
              </p>
            </div>

            {/* 项目咨询群二维码 */}
            <div className="flex flex-col items-center">
              <h4 className="text-sm font-semibold text-slate-900">
                项目咨询群
              </h4>
              <div className="mt-4 sm:mt-6 p-1.5 sm:p-2 bg-white border border-slate-100 rounded-xl shadow-sm">
                <img
                  src="/wyu/qr-group.jpg"
                  alt="2026中外联培项目咨询群"
                  className="w-20 h-20 sm:w-28 sm:h-28 object-cover rounded-lg"
                />
              </div>
              <p className="mt-2 sm:mt-3 text-[10px] sm:text-[11px] text-slate-400 text-center w-full">
                扫码加入项目咨询群
              </p>
            </div>
          </div>

          {/* 相关链接 */}
          <div className="lg:col-span-2 flex flex-col items-center sm:items-start">
            <h4 className="text-sm font-semibold text-slate-900">
              相关链接
            </h4>
            <ul className="mt-4 sm:mt-6 grid grid-cols-2 gap-y-3 gap-x-6 sm:flex sm:flex-col sm:gap-y-3 sm:gap-x-0 text-xs sm:text-sm text-slate-600 w-full sm:w-auto text-center sm:text-left justify-items-center sm:justify-items-start">
              <li>
                <a
                  className="group inline-flex items-center gap-1 hover:text-[#004a8c] transition-colors"
                  href="https://www.wyu.edu.cn"
                  target="_blank"
                  rel="noreferrer"
                >
                  五邑大学官网
                  <ExternalLink className="h-3 w-3 opacity-0 -translate-y-0.5 translate-x-0.5 transition-all group-hover:opacity-100 group-hover:translate-y-0 group-hover:translate-x-0" />
                </a>
              </li>
              <li>
                <a
                  className="group inline-flex items-center gap-1 hover:text-[#004a8c] transition-colors"
                  href="https://zsb.wyu.edu.cn"
                  target="_blank"
                  rel="noreferrer"
                >
                  五邑大学本科招生网
                  <ExternalLink className="h-3 w-3 opacity-0 -translate-y-0.5 translate-x-0.5 transition-all group-hover:opacity-100 group-hover:translate-y-0 group-hover:translate-x-0" />
                </a>
              </li>
              <li>
                <a
                  className="group inline-flex items-center gap-1 hover:text-[#004a8c] transition-colors"
                  href="https://www.wyu.edu.cn/sie/index.htm"
                  target="_blank"
                  rel="noreferrer"
                >
                  五邑大学国际教育学院
                  <ExternalLink className="h-3 w-3 opacity-0 -translate-y-0.5 translate-x-0.5 transition-all group-hover:opacity-100 group-hover:translate-y-0 group-hover:translate-x-0" />
                </a>
              </li>
              <li>
                <a
                  className="group inline-flex items-center gap-1 hover:text-[#004a8c] transition-colors"
                  href="https://www.kdocs.cn/l/cnMYivVM9XAC"
                  target="_blank"
                  rel="noreferrer"
                >
                  2026联合培养项目招生简章
                  <ExternalLink className="h-3 w-3 opacity-0 -translate-y-0.5 translate-x-0.5 transition-all group-hover:opacity-100 group-hover:translate-y-0 group-hover:translate-x-0" />
                </a>
              </li>
              <li>
                <a
                  className="group inline-flex items-center gap-1 hover:text-[#004a8c] transition-colors"
                  href="https://www.kdocs.cn/l/clbkCkhACqXa"
                  target="_blank"
                  rel="noreferrer"
                >
                  2026联合培养项目专业介绍
                  <ExternalLink className="h-3 w-3 opacity-0 -translate-y-0.5 translate-x-0.5 transition-all group-hover:opacity-100 group-hover:translate-y-0 group-hover:translate-x-0" />
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 sm:mt-16 md:mt-20 flex flex-col items-center justify-between gap-4 border-t border-slate-100 pt-6 sm:pt-8 text-xs sm:text-sm text-slate-500 sm:flex-row text-center sm:text-left">
          <p>© 2023 - 2026 五邑大学国际教育学院. All Rights Reserved</p>
          <div className="flex items-center justify-center gap-3 sm:gap-4">
            <span className="font-mono text-[10px] sm:text-xs tracking-wider uppercase text-slate-400">广东 · 江门</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
