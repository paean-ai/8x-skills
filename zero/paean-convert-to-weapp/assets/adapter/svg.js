// HTML's foreign-content parser adjusts these SVG names to their canonical XML
// spelling. Linkedom lowercases names created through innerHTML, so repair the
// serialization boundary before handing it to an XML SVG renderer.
const names='altGlyph altGlyphDef altGlyphItem animateColor animateMotion animateTransform clipPath feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile feTurbulence foreignObject glyphRef linearGradient radialGradient textPath'.split(' ');
const canonical=new Map(names.map(name=>[name.toLowerCase(),name]));
export function normalizeSVGMarkup(xml){return xml.replace(/(<\/?)([a-zA-Z][\w:-]*)(?=[\s/>])/g,(_,prefix,tag)=>prefix+(canonical.get(tag.toLowerCase())||tag));}
