import { Header } from './components/sections/Header';
import { Hero } from './components/sections/Hero';
import { Process } from './components/sections/Process';
import { About } from './components/sections/About';
import { Tariffs } from './components/sections/Tariffs';
import { Districts } from './components/sections/Districts';
import { Testimonials } from './components/sections/Testimonials';
import { Faq } from './components/sections/Faq';
import { Calculator } from './components/sections/Calculator';
import { Footer } from './components/sections/Footer';
import { StickyCta } from './components/sections/StickyCta';

function App() {
  return (
    <div className="min-h-screen bg-snow pb-16 md:pb-0">
      <Header />
      <main>
        <Hero />
        <Process />
        <About />
        <Tariffs />
        <Districts />
        <Testimonials />
        <Faq />
        <Calculator />
      </main>
      <Footer />
      <StickyCta />
    </div>
  );
}

export default App;
